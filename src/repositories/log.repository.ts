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

// ── cursor helpers ────────────────────────────────────────────────────────────

type CursorData = { ts: string; id: string };

function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify({ ts, id })).toString("base64url");
}

export function decodeCursor(raw: string): CursorData {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as Record<string, unknown>).ts !== "string" ||
      typeof (parsed as Record<string, unknown>).id !== "string"
    ) {
      throw new Error();
    }
    return parsed as CursorData;
  } catch {
    throw new AppError(400, "invalid or malformed cursor");
  }
}

// ── insert ────────────────────────────────────────────────────────────────────

export async function insertLogs(logs: InsertLog[]) {
  if (logs.length === 0) return;

  try {
    const values: unknown[] = [];
    const rows: string[] = [];

    logs.forEach((log, index) => {
      const n = index * 5 + 1;
      rows.push(`($${n}, $${n + 1}, $${n + 2}, $${n + 3}, $${n + 4})`);
      values.push(
        log.timestamp,
        log.level,
        log.service,
        log.message,
        JSON.stringify(log.attributes ?? {})
      );
    });

    await pool.query(
      `INSERT INTO logs (timestamp, level, service, message, attributes) VALUES ${rows.join(", ")}`,
      values
    );
  } catch (error) {
    console.error("INSERT failed:", error);
    throw new AppError(500, "failed to insert logs");
  }
}

// ── query ─────────────────────────────────────────────────────────────────────

export async function getLogs(params: LogQuery) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  const push = (val: unknown) => {
    values.push(val);
    return `$${values.length}`;
  };

  if (params.service) conditions.push(`service = ${push(params.service)}`);
  if (params.level)   conditions.push(`level = ${push(params.level)}`);
  if (params.since)   conditions.push(`timestamp >= ${push(params.since)}::timestamptz`);
  if (params.until)   conditions.push(`timestamp < ${push(params.until)}::timestamptz`);
  if (params.q)       conditions.push(`message ILIKE ${push(`%${params.q}%`)}`);

  // attr.<key>=value filters — compared as strings per spec
  if (params.attrs) {
    for (const [key, val] of Object.entries(params.attrs)) {
      conditions.push(`attributes->>${push(key)} = ${push(val)}`);
    }
  }

  // cursor: next page starts strictly after the last seen (timestamp, id)
  if (params.cursor) {
    const { ts, id } = decodeCursor(params.cursor);
    const p1 = push(ts);
    const p2 = push(id);
    conditions.push(`(timestamp, id) < (${p1}::timestamptz, ${p2}::bigint)`);
  }

  const limit = params.limit ?? 100;
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const result = await pool.query<{
      id: string;
      timestamp: Date;
      level: string;
      service: string;
      message: string;
      attributes: Record<string, unknown>;
    }>(
      `SELECT id, timestamp, level, service, message, attributes
       FROM logs
       ${where}
       ORDER BY timestamp DESC, id DESC
       LIMIT ${push(limit + 1)}`,
      values
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();

    const last = rows[rows.length - 1];
    const next_cursor =
      hasMore && last
        ? encodeCursor(last.timestamp.toISOString(), last.id)
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
    if (error instanceof AppError) throw error;
    console.error("GET logs failed:", error);
    throw new AppError(500, "failed to fetch logs");
  }
}
