import { apiGet } from "./client";
import { toIso } from "../lib/datetime";
import type {
  AggregateResponse,
  BucketSize,
  GroupBy,
  LogsResponse,
  SharedFilters,
} from "../types";

// service/level/since/until/attr.<key>/q are accepted by both GET /logs and
// GET /logs/aggregate, so both request builders share this.
function sharedParams(filters: SharedFilters): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {
    service: filters.service || undefined,
    level: filters.level || undefined,
    since: toIso(filters.since),
    until: toIso(filters.until),
    q: filters.q || undefined,
  };
  for (const { key, value } of filters.attrs) {
    if (key) params[`attr.${key}`] = value;
  }
  return params;
}

export function fetchLogs(
  filters: SharedFilters,
  limit: number,
  cursor?: string
): Promise<LogsResponse> {
  return apiGet<LogsResponse>("/logs", {
    ...sharedParams(filters),
    limit: String(limit),
    cursor,
  });
}

export function fetchAggregate(
  filters: SharedFilters,
  bucket: BucketSize,
  groupBy: GroupBy
): Promise<AggregateResponse> {
  return apiGet<AggregateResponse>("/logs/aggregate", {
    ...sharedParams(filters),
    bucket,
    group_by: groupBy || undefined,
  });
}
