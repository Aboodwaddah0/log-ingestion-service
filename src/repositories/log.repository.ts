import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { from as copyFrom } from "pg-copy-streams";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { AppError } from "../errors/AppError.js";


export interface InsertLog {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  service: string;
  message: string;
  attributes?: Record<string, string | number | boolean>;
}



export interface LogQuery {
  service?: string;
  level?: "debug" | "info" | "warn" | "error";
  since?: string;
  until?: string;
  q?: string;
  limit?: number;
  cursor?: string;
  attrs?: Record<string, string>;
}


export interface AggregateQuery {
  since: string;
  until: string;
  bucket: "1m" | "5m" | "1h" | "1d";
  group_by?: "service" | "level";
  service?: string;
  level?: "debug" | "info" | "warn" | "error";
  q?: string;
  attrs?: Record<string, string>;
}

function isPoolTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === "timeout exceeded when trying to connect";
}

// Postgres query_canceled (statement_timeout fired) — the pool's statement_timeout
// is a runaway-query guard, not a latency policy, so this maps to the same
// backpressure signal as a pool-connect timeout.
function isStatementTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "57014";
}

// attributes is indexed with a jsonb_path_ops GIN index, which only supports the
// containment operator (@>) — not the ->> text-extraction operator this used to
// use. @> is type-strict, so the stored value's type has to be guessed from the
// query-string value (always a string) to keep matching what ->> matched before:
// a numeric-looking value must also match a stored JSON number, "true"/"false"
// must also match a stored JSON boolean.
function attrCondition(push: (val: unknown) => string, key: string, val: string): string {
  const keyPlaceholder = push(key);
  const candidates = [`jsonb_build_object(${keyPlaceholder}::text, ${push(val)}::text)`];
  if (val !== "" && !Number.isNaN(Number(val))) {
    candidates.push(`jsonb_build_object(${keyPlaceholder}::text, ${push(val)}::numeric)`);
  }
  if (val === "true" || val === "false") {
    candidates.push(`jsonb_build_object(${keyPlaceholder}::text, ${push(val)}::boolean)`);
  }
  return `(${candidates.map((c) => `attributes @> ${c}`).join(" OR ")})`;
}

 
const CURSOR_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z),(\d+)$/;

function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts},${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { ts: string; id: string } | null {
  const tryMatch = (s: string) => {
    const m = CURSOR_PATTERN.exec(s);
    return m ? { ts: m[1], id: m[2] } : null;
  };
  return tryMatch(Buffer.from(cursor, "base64url").toString("utf8")) ?? tryMatch(cursor);
}

function csvField(s: string): string {
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}


const CHUNK_SIZE = 65536;

function* logsToCsvChunks(logs: InsertLog[]): Generator<string> {
  let buf = "";
  for (const log of logs) {
    buf +=
      log.timestamp + "," +
      log.level + "," +
      csvField(log.service) + "," +
      csvField(log.message) + "," +
      csvField(JSON.stringify(log.attributes ?? {})) + "\n";

    if (buf.length >= CHUNK_SIZE) {
      yield buf;
      buf = "";
    }
  }
  if (buf.length > 0) yield buf;
}

interface RollupDelta {
  bucket_start: string;
  service: string;
  level: string;
  count: number;
}

function computeRollupDeltas(logs: InsertLog[]): RollupDelta[] {
  const deltas = new Map<string, RollupDelta>();
  for (const log of logs) {
    const bucketMs = Math.floor(new Date(log.timestamp).getTime() / 60_000) * 60_000;
    const bucketIso = new Date(bucketMs).toISOString();
    const key = `${bucketIso}|${log.service}|${log.level}`;
    const existing = deltas.get(key);
    if (existing) {
      existing.count++;
    } else {
      deltas.set(key, { bucket_start: bucketIso, service: log.service, level: log.level, count: 1 });
    }
  }
  return [...deltas.values()];
}

async function upsertRollup(client: PoolClient, deltas: RollupDelta[]):Promise<void> {
  
  if (deltas.length === 0) return;

  const values: unknown[] = [];

  const placeholders = deltas
    .map((delta) => {
      const i = values.length;

      values.push(
        delta.bucket_start,
        delta.service,
        delta.level,
        delta.count
      );

      return `($${i + 1}::timestamptz, $${i + 2}, $${i + 3}, $${i + 4}::bigint)`;
    })
    .join(", ");

  await client.query(
    `
      INSERT INTO logs_agg_1m
        (bucket_start, service, level, count)
      VALUES ${placeholders}
      ON CONFLICT (bucket_start, service, level)
      DO UPDATE SET
        count = logs_agg_1m.count + EXCLUDED.count
    `,
    values
  );
}

const MAX_PENDING_ROWS = 50_000;

interface PendingWaiter {
  resolve: () => void;
  reject: (err: unknown) => void;
}

let pendingLogs: InsertLog[] = [];
let pendingWaiters: PendingWaiter[] = [];
let pendingRowCount = 0;
let flushing = false;

async function flushBatch(logs: InsertLog[]): Promise<void> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    if (isPoolTimeout(error)) {
      throw new AppError(503, "database overloaded, retry later");
    }
    console.error("failed to acquire connection:", error);
    throw new AppError(500, "failed to insert logs");
  }

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL synchronous_commit = off");

    const copyStream = client.query(
      copyFrom(
        "COPY logs (timestamp, level, service, message, attributes) FROM STDIN WITH (FORMAT csv)"
      )
    );
    await pipeline(Readable.from(logsToCsvChunks(logs)), copyStream);
    await upsertRollup(client, computeRollupDeltas(logs));

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("flush failed:", error);
    throw error instanceof AppError ? error : new AppError(500, "failed to insert logs");
  } finally {
    client.release();
  }
}

async function runFlush(): Promise<void> {
  flushing = true;
  while (pendingLogs.length > 0) {
    const logs = pendingLogs;
    const waiters = pendingWaiters;
    pendingLogs = [];
    pendingWaiters = [];
    pendingRowCount = 0;

    try {
      await flushBatch(logs);
      for (const w of waiters) w.resolve();
    } catch (error) {
      for (const w of waiters) w.reject(error);
    }
  }
  flushing = false;
}

export async function insertLogs(logs: InsertLog[]): Promise<void> {
  if (logs.length === 0) return;

  if (pendingRowCount + logs.length > MAX_PENDING_ROWS) {
    throw new AppError(503, "database overloaded, retry later");
  }

  const done = new Promise<void>((resolve, reject) => {
    pendingLogs.push(...logs);
    pendingWaiters.push({ resolve, reject });
    pendingRowCount += logs.length;
  });

  if (!flushing) {
    void runFlush();
  }

  return done;
}

// ── query ─────────────────────────────────────────────────────────────────────

export async function getLogs(params: LogQuery) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  const push = (val: unknown) => {
    values.push(val);
    return `$${values.length}`;
  };

  if (params.service) {
    conditions.push(`service = ${push(params.service)}`);
  }

  if (params.level) {
    conditions.push(`level = ${push(params.level)}`);
  }

  if (params.since) {
    conditions.push(
      `timestamp >= ${push(params.since)}::timestamptz`
    );
  }

  if (params.until) {
    conditions.push(
      `timestamp < ${push(params.until)}::timestamptz`
    );
  }

  if (params.q) {
    conditions.push(
      `message ILIKE ${push(`%${params.q}%`)}`
    );
  }

  if (params.attrs) {
    for (const [key, val] of Object.entries(params.attrs)) {
      conditions.push(attrCondition(push, key, val));
    }
  }

  if (params.cursor) {
    const parsed = decodeCursor(params.cursor);
    if (!parsed) {
      throw new AppError(400, "invalid or malformed cursor");
    }
    conditions.push(
      `(timestamp, id) < (${push(parsed.ts)}::timestamptz, ${push(parsed.id)}::bigint)`
    );
  }

  const limit = params.limit ?? 100;

  const where = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  try {
    const result = await pool.query<{
      id: string;
      timestamp: Date;
      level: string;
      service: string;
      message: string;
      attributes: Record<string, unknown>;
      cursor_ts: string;
    }>(
      `SELECT id, timestamp, level, service, message, attributes,
              to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
       FROM logs
       ${where}
       ORDER BY timestamp DESC, id DESC
       LIMIT ${push(limit + 1)}`,
      values
    );

    const rows = result.rows;

    const hasMore = rows.length > limit;

    if (hasMore) {
      rows.pop();
    }

    const last = rows[rows.length - 1];

    const next_cursor =
      hasMore && last
        ? encodeCursor(last.cursor_ts, last.id)
        : null;

    return {
      logs: rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp.toISOString(),
        level: r.level,
        service: r.service,
        message: r.message,
        attributes: r.attributes,
      })),
      next_cursor,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (isPoolTimeout(error) || isStatementTimeout(error)) {
      throw new AppError(503, "database overloaded, retry later");
    }

    console.error("GET logs failed:", error);
    throw new AppError(500, "failed to fetch logs");
  }
}

// ── aggregate ─────────────────────────────────────────────────────────────────

const BUCKET_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "1h": 3600,
  "1d": 86400,
};

export async function aggregateLogs(params: AggregateQuery) {
  if (params.attrs || params.q) {
    return aggregateFromScan(params);
  }
  return aggregateFromRollup(params);
}

async function aggregateFromRollup(params: AggregateQuery) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  const push = (val: unknown) => {
    values.push(val);
    return `$${values.length}`;
  };

  conditions.push(`bucket_start >= ${push(params.since)}::timestamptz`);
  conditions.push(`bucket_start < ${push(params.until)}::timestamptz`);
  if (params.service) conditions.push(`service = ${push(params.service)}`);
  if (params.level)   conditions.push(`level = ${push(params.level)}`);

  const where = `WHERE ${conditions.join(" AND ")}`;

  
  const bucketSec = BUCKET_SECONDS[params.bucket];
  const bucketExpr = `to_timestamp(floor(extract(epoch from bucket_start) / ${bucketSec}) * ${bucketSec})`;


  const groupSelect = params.group_by ? `${params.group_by} AS group` : `NULL::text AS group`;
  const groupBy     = params.group_by ? `1, 2` : `1`;

  const sql = `
    SELECT
      ${bucketExpr} AS bucket_start,
      ${groupSelect},
      SUM(count)::int AS count
    FROM logs_agg_1m
    ${where}
    GROUP BY ${groupBy}
    ORDER BY bucket_start ASC
  `;

  try {
    const result = await pool.query<{
      bucket_start: Date;
      group: string | null;
      count: number;
    }>(sql, values);

    return {
      buckets: result.rows.map((r) => ({
        start: r.bucket_start.toISOString(),
        group: r.group,
        count: r.count,
      })),
    };
  } catch (error) {
    if (isPoolTimeout(error) || isStatementTimeout(error)) {
      throw new AppError(503, "database overloaded, retry later");
    }
    console.error("aggregate (rollup) failed:", error);
    throw new AppError(500, "failed to aggregate logs");
  }
}

async function aggregateFromScan(params: AggregateQuery) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  const push = (val: unknown) => {
    values.push(val);
    return `$${values.length}`;
  };

  conditions.push(`timestamp >= ${push(params.since)}::timestamptz`);
  conditions.push(`timestamp < ${push(params.until)}::timestamptz`);

  if (params.service) conditions.push(`service = ${push(params.service)}`);
  if (params.level)   conditions.push(`level = ${push(params.level)}`);
  if (params.q)       conditions.push(`message ILIKE ${push(`%${params.q}%`)}`);
  if (params.attrs) {
    for (const [key, val] of Object.entries(params.attrs)) {
      conditions.push(attrCondition(push, key, val));
    }
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const bucketSec = BUCKET_SECONDS[params.bucket];
  const bucketExpr = `to_timestamp(floor(extract(epoch from timestamp) / ${bucketSec}) * ${bucketSec})`;

  const groupSelect = params.group_by ? `${params.group_by} AS group` : `NULL::text AS group`;
  const groupBy     = params.group_by ? `1, 2` : `1`;

  const sql = `
    SELECT
      ${bucketExpr} AS bucket_start,
      ${groupSelect},
      COUNT(*)::int AS count
    FROM logs
    ${where}
    GROUP BY ${groupBy}
    ORDER BY bucket_start ASC
  `;

  try {
    const result = await pool.query<{
      bucket_start: Date;
      group: string | null;
      count: number;
    }>(sql, values);

    return {
      buckets: result.rows.map((r) => ({
        start: r.bucket_start.toISOString(),
        group: r.group,
        count: r.count,
      })),
    };
  } catch (error) {
    if (isPoolTimeout(error) || isStatementTimeout(error)) {
      throw new AppError(503, "database overloaded, retry later");
    }
    console.error("aggregate failed:", error);
    throw new AppError(500, "failed to aggregate logs");
  }
}
