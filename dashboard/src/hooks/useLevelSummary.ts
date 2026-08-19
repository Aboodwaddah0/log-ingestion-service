import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { fetchAggregate } from "../api/logs";
import type { LogLevel, SharedFilters } from "../types";

export interface LevelSummary {
  total: number;
  byLevel: Record<LogLevel, number>;
}

const EMPTY: LevelSummary = { total: 0, byLevel: { debug: 0, info: 0, warn: 0, error: 0 } };

// Independent of whatever bucket/group_by the chart itself is set to — this
// always asks for level totals over the whole range in as few buckets as
// possible (bucket=1d), then sums them, so the KPI strip stays correct no
// matter what the chart is currently showing.
export function useLevelSummary(filters: SharedFilters) {
  const [summary, setSummary] = useState<LevelSummary>(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filters.since || !filters.until) {
      setSummary(EMPTY);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchAggregate(filters, "1d", "level")
      .then((result) => {
        if (cancelled) return;
        const byLevel: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
        let total = 0;
        for (const b of result.buckets) {
          if (b.group && b.group in byLevel) {
            byLevel[b.group as LogLevel] += b.count;
          }
          total += b.count;
        }
        setSummary({ total, byLevel });
      })
      .catch((err) => {
        if (!cancelled && !(err instanceof ApiError)) console.error(err);
        if (!cancelled) setSummary(EMPTY);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters]);

  return { summary, loading };
}
