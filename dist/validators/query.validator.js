import { AppError } from "../errors/AppError.js";
const VALID_LEVELS = new Set(["debug", "info", "warn", "error"]);
export function validateLogQuery(query) {
    const { service, level, since, until, q, limit: limitRaw, cursor } = query;
    if (level !== undefined && !VALID_LEVELS.has(String(level))) {
        throw new AppError(400, `invalid level: '${level}'`);
    }
    if (since !== undefined && isNaN(new Date(String(since)).getTime())) {
        throw new AppError(400, "invalid since timestamp");
    }
    if (until !== undefined && isNaN(new Date(String(until)).getTime())) {
        throw new AppError(400, "invalid until timestamp");
    }
    if (since && until && new Date(String(since)) >= new Date(String(until))) {
        throw new AppError(400, "until must be after since");
    }
    let limit = 100;
    if (limitRaw !== undefined) {
        const n = Number(limitRaw);
        if (!Number.isInteger(n))
            throw new AppError(400, "limit must be an integer");
        if (n < 1 || n > 1000)
            throw new AppError(400, "limit must be between 1 and 1000");
        limit = n;
    }
    const attrs = {};
    for (const [key, val] of Object.entries(query)) {
        if (key.startsWith("attr.")) {
            attrs[key.slice(5)] = String(val);
        }
    }
    return {
        service: service !== undefined ? String(service) : undefined,
        level: level !== undefined ? String(level) : undefined,
        since: since !== undefined ? String(since) : undefined,
        until: until !== undefined ? String(until) : undefined,
        q: q !== undefined ? String(q) : undefined,
        limit,
        cursor: cursor !== undefined ? String(cursor) : undefined,
        attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
    };
}
