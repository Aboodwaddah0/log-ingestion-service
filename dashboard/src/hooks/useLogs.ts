import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { fetchLogs } from "../api/logs";
import type { LogEntry, SharedFilters } from "../types";

const PAGE_SIZE = 100;

export function useLogs(filters: SharedFilters) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters can change faster than a request resolves (e.g. typing in the
  // search box). This tags each request so a late response from a stale
  // filter set can never overwrite state from a newer one.
  const requestId = useRef(0);

  const load = useCallback(
    async (cursor: string | undefined, append: boolean) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchLogs(filters, PAGE_SIZE, cursor);
        if (id !== requestId.current) return;
        setLogs((prev) => (append ? [...prev, ...result.logs] : result.logs));
        setNextCursor(result.next_cursor);
      } catch (err) {
        if (id !== requestId.current) return;
        setError(err instanceof ApiError ? err.message : "failed to load logs");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    void load(undefined, false);
  }, [load]);

  const loadMore = useCallback(() => {
    if (nextCursor) void load(nextCursor, true);
  }, [load, nextCursor]);

  return { logs, nextCursor, loading, error, loadMore };
}
