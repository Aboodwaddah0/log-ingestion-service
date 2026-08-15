import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { fetchAggregate } from "../api/logs";
import type { AggregateBucket, BucketSize, GroupBy, SharedFilters } from "../types";

export function useAggregate(filters: SharedFilters, bucket: BucketSize, groupBy: GroupBy) {
  const [buckets, setBuckets] = useState<AggregateBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // since/until are required by GET /logs/aggregate — asking would just
    // come back as a 400, so skip the round trip and say so directly.
    if (!filters.since || !filters.until) {
      setBuckets([]);
      setError("select a since/until range to view the chart");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAggregate(filters, bucket, groupBy)
      .then((result) => {
        if (!cancelled) setBuckets(result.buckets);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "failed to load aggregate");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters, bucket, groupBy]);

  return { buckets, loading, error };
}
