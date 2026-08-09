import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { from as copyFrom } from "pg-copy-streams";
import { pool } from "../db/pool.js";
import { AppError } from "../errors/AppError.js";
// ── insert ────────────────────────────────────────────────────────────────────
function csvField(s) {
    return '"' + s.replace(/"/g, '""') + '"';
}
function* logsToCsvRows(logs) {
    for (const log of logs) {
        yield [
            csvField(log.timestamp),
            csvField(log.level),
            csvField(log.service),
            csvField(log.message),
            csvField(JSON.stringify(log.attributes ?? {})),
        ].join(",") + "\n";
    }
}
export async function insertLogs(logs) {
    if (logs.length === 0)
        return;
    const client = await pool.connect();
    try {
        const copyStream = client.query(copyFrom("COPY logs (timestamp, level, service, message, attributes) FROM STDIN WITH (FORMAT csv)"));
        await pipeline(Readable.from(logsToCsvRows(logs)), copyStream);
    }
    catch (error) {
        console.error("COPY failed:", error);
        throw new AppError(500, "failed to insert logs");
    }
    finally {
        client.release();
    }
}
// ── query ─────────────────────────────────────────────────────────────────────
export async function getLogs(params) {
    const conditions = [];
    const values = [];
    const push = (val) => {
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
        conditions.push(`timestamp >= ${push(params.since)}::timestamptz`);
    }
    if (params.until) {
        conditions.push(`timestamp < ${push(params.until)}::timestamptz`);
    }
    if (params.q) {
        conditions.push(`message ILIKE ${push(`%${params.q}%`)}`);
    }
    if (params.attrs) {
        for (const [key, val] of Object.entries(params.attrs)) {
            conditions.push(`attributes->>${push(key)} = ${push(val)}`);
        }
    }
    if (params.cursor) {
        const parts = params.cursor.split(",");
        const [ts, id] = parts;
        if (parts.length !== 2 || !ts || !id || isNaN(new Date(ts).getTime()) || !/^\d+$/.test(id)) {
            throw new AppError(400, "invalid or malformed cursor");
        }
        conditions.push(`(timestamp, id) < (${push(ts)}::timestamptz, ${push(id)}::bigint)`);
    }
    const limit = params.limit ?? 100;
    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
    try {
        const result = await pool.query(`SELECT id, timestamp, level, service, message, attributes
       FROM logs
       ${where}
       ORDER BY timestamp DESC, id DESC
       LIMIT ${push(limit + 1)}`, values);
        const rows = result.rows;
        const hasMore = rows.length > limit;
        if (hasMore) {
            rows.pop();
        }
        const last = rows[rows.length - 1];
        const next_cursor = hasMore && last
            ? `${last.timestamp.toISOString()},${last.id}`
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
    }
    catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        console.error("GET logs failed:", error);
        throw new AppError(500, "failed to fetch logs");
    }
}
// ── aggregate ─────────────────────────────────────────────────────────────────
const BUCKET_SECONDS = {
    "1m": 60,
    "5m": 300,
    "1h": 3600,
    "1d": 86400,
};
export async function aggregateLogs(params) {
    const conditions = [];
    const values = [];
    const push = (val) => {
        values.push(val);
        return `$${values.length}`;
    };
    conditions.push(`timestamp >= ${push(params.since)}::timestamptz`);
    conditions.push(`timestamp < ${push(params.until)}::timestamptz`);
    if (params.service)
        conditions.push(`service = ${push(params.service)}`);
    if (params.level)
        conditions.push(`level = ${push(params.level)}`);
    if (params.q)
        conditions.push(`message ILIKE ${push(`%${params.q}%`)}`);
    if (params.attrs) {
        for (const [key, val] of Object.entries(params.attrs)) {
            conditions.push(`attributes->>${push(key)} = ${push(val)}`);
        }
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    // bucketSec is always one of {60,300,3600,86400} — safe to inline
    const bucketSec = BUCKET_SECONDS[params.bucket];
    const bucketExpr = `to_timestamp(floor(extract(epoch from timestamp) / ${bucketSec}) * ${bucketSec})`;
    // group_by is always "service" or "level" (validated) — safe to inline as column name
    const groupSelect = params.group_by ? `${params.group_by} AS group` : `NULL::text AS group`;
    const groupBy = params.group_by ? `1, 2` : `1`;
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
        const result = await pool.query(sql, values);
        return {
            buckets: result.rows.map((r) => ({
                start: r.bucket_start.toISOString(),
                group: r.group,
                count: r.count,
            })),
        };
    }
    catch (error) {
        console.error("aggregate failed:", error);
        throw new AppError(500, "failed to aggregate logs");
    }
}
