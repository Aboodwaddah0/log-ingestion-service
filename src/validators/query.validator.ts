import { AppError } from "../errors/AppError.js";
import type { AggregateQuery, LogQuery } from "../repositories/log.repository.js";

const VALID_LEVELS = new Set(["debug", "info", "warn", "error"]);

export function validateLogQuery(query: Record<string, unknown>): LogQuery {
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
    if (!Number.isInteger(n)) throw new AppError(400, "limit must be an integer");
    if (n < 1 || n > 1000) throw new AppError(400, "limit must be between 1 and 1000");
    limit = n;
  }

  

  const attrs: Record<string, string> = {};
  for (const [key, val] of Object.entries(query)) {
    if (key.startsWith("attr.")) {
      attrs[key.slice(5)] = String(val);
    }
  }

  return {
    service: service !== undefined ? String(service) : undefined,
    level: level !== undefined ? (String(level) as LogQuery["level"]) : undefined,
    since: since !== undefined ? String(since) : undefined,
    until: until !== undefined ? String(until) : undefined,
    q: q !== undefined ? String(q) : undefined,
    limit,
    cursor: cursor !== undefined ? String(cursor) : undefined,
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
  };
}

const VALID_BUCKETS  = new Set(["1m", "5m", "1h", "1d"]);
const VALID_GROUP_BY = new Set(["service", "level"]);

export function validateAggregateQuery(query: Record<string, unknown>): AggregateQuery {
  const { since, until, bucket, group_by, service, level, q } = query;

  if (since === undefined) throw new AppError(400, "since is required");
  if (isNaN(new Date(String(since)).getTime())) throw new AppError(400, "invalid since timestamp");

  if (until === undefined) throw new AppError(400, "until is required");
  if (isNaN(new Date(String(until)).getTime())) throw new AppError(400, "invalid until timestamp");

  if (new Date(String(since)) >= new Date(String(until))) throw new AppError(400, "until must be after since");

  if (bucket === undefined) throw new AppError(400, "bucket is required");
  if (!VALID_BUCKETS.has(String(bucket))) throw new AppError(400, `invalid bucket: '${bucket}', must be one of 1m, 5m, 1h, 1d`);

  if (group_by !== undefined && !VALID_GROUP_BY.has(String(group_by))) {
    throw new AppError(400, `invalid group_by: '${group_by}', must be service or level`);
  }

  if (level !== undefined && !VALID_LEVELS.has(String(level))) {
    throw new AppError(400, `invalid level: '${level}'`);
  }

  const attrs: Record<string, string> = {};
  for (const [key, val] of Object.entries(query)) {
    if (key.startsWith("attr.")) attrs[key.slice(5)] = String(val);
  }

  return {
    since:    String(since),
    until:    String(until),
    bucket:   String(bucket) as AggregateQuery["bucket"],
    group_by: group_by !== undefined ? String(group_by) as AggregateQuery["group_by"] : undefined,
    service:  service !== undefined ? String(service) : undefined,
    level:    level   !== undefined ? String(level) as AggregateQuery["level"] : undefined,
    q:        q       !== undefined ? String(q) : undefined,
    attrs:    Object.keys(attrs).length > 0 ? attrs : undefined,
  };
}
