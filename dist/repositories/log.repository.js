import { pool } from "../db/pool.js";
import { AppError } from "../errors/AppError.js";
function encodeCursor(ts, id) {
    return Buffer.from(JSON.stringify({ ts, id })).toString("base64url");
}
export function decodeCursor(raw) {
    try {
        const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
        if (!parsed ||
            typeof parsed !== "object" ||
            typeof parsed.ts !== "string" ||
            typeof parsed.id !== "string") {
            throw new Error();
        }
        return parsed;
    }
    catch {
        throw new AppError(400, "invalid or malformed cursor");
    }
}
// ── insert ────────────────────────────────────────────────────────────────────
export async function insertLogs(logs) {
    if (logs.length === 0)
        return;
    try {
        const values = [];
        const rows = [];
        logs.forEach((log, index) => {
            const n = index * 5 + 1;
            rows.push(`($${n}, $${n + 1}, $${n + 2}, $${n + 3}, $${n + 4})`);
            values.push(log.timestamp, log.level, log.service, log.message, JSON.stringify(log.attributes ?? {}));
        });
        await pool.query(`INSERT INTO logs (timestamp, level, service, message, attributes) VALUES ${rows.join(", ")}`, values);
    }
    catch (error) {
        console.error("INSERT failed:", error);
        throw new AppError(500, "failed to insert logs");
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
    if (params.service)
        conditions.push(`service = ${push(params.service)}`);
    if (params.level)
        conditions.push(`level = ${push(params.level)}`);
    if (params.since)
        conditions.push(`timestamp >= ${push(params.since)}::timestamptz`);
    if (params.until)
        conditions.push(`timestamp < ${push(params.until)}::timestamptz`);
    if (params.q)
        conditions.push(`message ILIKE ${push(`%${params.q}%`)}`);
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
        const result = await pool.query(`SELECT id, timestamp, level, service, message, attributes
       FROM logs
       ${where}
       ORDER BY timestamp DESC, id DESC
       LIMIT ${push(limit + 1)}`, values);
        const rows = result.rows;
        const hasMore = rows.length > limit;
        if (hasMore)
            rows.pop();
        const last = rows[rows.length - 1];
        const next_cursor = hasMore && last
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
    }
    catch (error) {
        if (error instanceof AppError)
            throw error;
        console.error("GET logs failed:", error);
        throw new AppError(500, "failed to fetch logs");
    }
}
