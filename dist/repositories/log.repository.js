import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { from as copyFrom } from "pg-copy-streams";
import { pool } from "../db/pool.js";
import { AppError } from "../errors/AppError.js";
// ── insert ────────────────────────────────────────────────────────────────────
// timestamp and level are never passed here — plain ASCII, never need quoting.
function csvField(s) {
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}
// Flush accumulated rows to the stream in ~64 KB chunks instead of one yield
// per row, which cuts stream-write overhead by ~100× for a 5,000-row batch.
const CHUNK_SIZE = 65536;
function* logsToCsvChunks(logs) {
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
    if (buf.length > 0)
        yield buf;
}
// ── write buffer ──────────────────────────────────────────────────────────────
// Accumulate logs across HTTP requests and flush in larger batches.
// POST /logs returns 200 immediately after validation; writes land ≤200ms later.
const FLUSH_MS = 200;
const FLUSH_THRESHOLD = 10_000;
const MAX_BUFFER = 100_000;
const writeBuffer = [];
let flushTimer = null;
let flushing = false;
function scheduleFlush(delayMs) {
    if (flushTimer !== null)
        return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        doFlush().catch((err) => console.error("[flush] error:", err));
    }, delayMs);
}
async function doFlush() {
    if (flushing || writeBuffer.length === 0)
        return;
    flushing = true;
    const batch = writeBuffer.splice(0);
    try {
        await copyBatch(batch);
    }
    catch (err) {
        console.error("[flush] COPY failed, dropped", batch.length, "logs:", err);
    }
    finally {
        flushing = false;
        if (writeBuffer.length > 0)
            scheduleFlush(0);
    }
}
async function copyBatch(logs) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // SET LOCAL scopes both GUCs to this transaction so they don't leak
        // onto the shared pool connection after COMMIT/ROLLBACK.
        // synchronous_commit=off: don't block on WAL fsync (safe for append-only logs).
        // gin_pending_list_limit=64MB: defer GIN index flushes; default 4MB flushes
        //   every few hundred rows and hammers CPU.
        await client.query("SET LOCAL synchronous_commit = off");
        await client.query("SET LOCAL gin_pending_list_limit = '64MB'");
        const copyStream = client.query(copyFrom("COPY logs (timestamp, level, service, message, attributes) FROM STDIN WITH (FORMAT csv)"));
        await pipeline(Readable.from(logsToCsvChunks(logs)), copyStream);
        await client.query("COMMIT");
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
}
export async function insertLogs(logs) {
    if (logs.length === 0)
        return;
    if (writeBuffer.length >= MAX_BUFFER) {
        throw new AppError(503, "log buffer full, retry later");
    }
    // Avoid spread — push(...array) throws RangeError at ~125k args (V8 stack limit).
    for (const log of logs)
        writeBuffer.push(log);
    if (writeBuffer.length >= FLUSH_THRESHOLD) {
        if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        doFlush().catch((err) => console.error("[flush] error:", err));
    }
    else {
        scheduleFlush(FLUSH_MS);
    }
}
// Call on SIGTERM/SIGINT to flush buffered logs before exit.
export async function drainBuffer() {
    if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    while (flushing) {
        await new Promise((r) => setTimeout(r, 20));
    }
    if (writeBuffer.length > 0) {
        flushing = true;
        const batch = writeBuffer.splice(0);
        try {
            await copyBatch(batch);
        }
        catch (err) {
            console.error("[drain] COPY failed, dropped", batch.length, "logs:", err);
        }
        finally {
            flushing = false;
        }
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
