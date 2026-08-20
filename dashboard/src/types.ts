export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  attributes: Record<string, unknown>;
}

export interface LogsResponse {
  logs: LogEntry[];
  next_cursor: string | null;
}

// GET /logs/tail streams the same shape as LogEntry minus `id` — the ingest
// path uses Postgres COPY, which never returns generated identity values.
export type LiveLogEntry = Omit<LogEntry, "id">;

export interface AggregateBucket {
  start: string;
  group: string | null;
  count: number;
}

export interface AggregateResponse {
  buckets: AggregateBucket[];
}

export type BucketSize = "1m" | "5m" | "1h" | "1d";
export type GroupBy = "" | "service" | "level";

export interface AttributeFilter {
  key: string;
  value: string;
}

// since/until are stored as <input type="datetime-local"> string values
// ("" when unset) and converted to ISO 8601 only when a request is built.
export interface SharedFilters {
  service: string;
  level: LogLevel | "";
  since: string;
  until: string;
  q: string;
  attrs: AttributeFilter[];
}
