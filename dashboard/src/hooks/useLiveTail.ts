import { useEffect, useRef, useState } from "react";
import { buildTailUrl } from "../api/logs";
import type { LiveLogEntry, SharedFilters } from "../types";

const MAX_ENTRIES = 300;

export type TailStatus = "idle" | "connecting" | "open" | "error";

export interface TailItem {
  seq: number;
  log: LiveLogEntry;
}

// Newest-first, capped client-side — the server already caps concurrent
// connections (LIVE_TAIL_MAX_CLIENTS), this caps memory for one connection
// left running for a long time.
export function useLiveTail(filters: SharedFilters, enabled: boolean) {
  const [entries, setEntries] = useState<TailItem[]>([]);
  const [status, setStatus] = useState<TailStatus>("idle");
  const seqRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    setStatus("connecting");
    const source = new EventSource(
      buildTailUrl({ service: filters.service, level: filters.level, q: filters.q, attrs: filters.attrs })
    );

    source.onopen = () => setStatus("open");
    // EventSource retries automatically on its own (native reconnect with
    // backoff) — including while the server is at LIVE_TAIL_MAX_CLIENTS and
    // returning 503, so this only needs to reflect status, not reconnect.
    source.onerror = () => setStatus("error");
    source.onmessage = (event) => {
      const log = JSON.parse(event.data) as LiveLogEntry;
      seqRef.current += 1;
      setEntries((prev) => [{ seq: seqRef.current, log }, ...prev].slice(0, MAX_ENTRIES));
    };

    return () => source.close();
    // Reconnects only when a filter that actually changes what the server
    // sends changes — since/until aren't sent to /logs/tail at all, so they
    // must not be in this dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, filters.service, filters.level, filters.q, JSON.stringify(filters.attrs)]);

  const clear = () => setEntries([]);

  return { entries, status, clear };
}
