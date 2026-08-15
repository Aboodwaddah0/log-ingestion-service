import { useMemo } from "react";
import type { AggregateBucket, BucketSize, GroupBy } from "../types";

interface Props {
  buckets: AggregateBucket[];
  loading: boolean;
  error: string | null;
  bucket: BucketSize;
  groupBy: GroupBy;
  onBucketChange: (bucket: BucketSize) => void;
  onGroupByChange: (groupBy: GroupBy) => void;
}

const BUCKET_SIZES: BucketSize[] = ["1m", "5m", "1h", "1d"];
const COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

export function AggregateChart({
  buckets,
  loading,
  error,
  bucket,
  groupBy,
  onBucketChange,
  onGroupByChange,
}: Props) {
  // group_by can produce multiple rows per bucket start (one per service/level).
  // Reshape into start -> group -> count so each bucket renders as one column
  // with one bar per group, all sharing the same height scale.
  const { starts, groups, matrix, max } = useMemo(() => {
    const startSet = new Set<string>();
    const groupSet = new Set<string>();
    const matrix = new Map<string, Map<string, number>>();
    let max = 0;

    for (const b of buckets) {
      const key = b.group ?? "count";
      startSet.add(b.start);
      groupSet.add(key);
      if (!matrix.has(b.start)) matrix.set(b.start, new Map());
      matrix.get(b.start)!.set(key, b.count);
      if (b.count > max) max = b.count;
    }

    return { starts: [...startSet].sort(), groups: [...groupSet], matrix, max };
  }, [buckets]);

  return (
    <div className="aggregate-chart">
      <div className="chart-controls">
        <label>
          Bucket
          <select value={bucket} onChange={(e) => onBucketChange(e.target.value as BucketSize)}>
            {BUCKET_SIZES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label>
          Group by
          <select value={groupBy} onChange={(e) => onGroupByChange(e.target.value as GroupBy)}>
            <option value="">none</option>
            <option value="service">service</option>
            <option value="level">level</option>
          </select>
        </label>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <span>Loading…</span>}
      {!loading && !error && starts.length === 0 && <p className="empty">No data in this range.</p>}

      {!loading && starts.length > 0 && (
        <>
          <div className="chart-bars">
            {starts.map((start) => (
              <div className="chart-column" key={start} title={new Date(start).toLocaleString()}>
                <div className="chart-bar-group">
                  {groups.map((g, i) => {
                    const count = matrix.get(start)?.get(g) ?? 0;
                    const height = max > 0 ? (count / max) * 100 : 0;
                    return (
                      <div
                        key={g}
                        className="chart-bar"
                        style={{ height: `${height}%`, background: COLORS[i % COLORS.length] }}
                        title={`${g}: ${count}`}
                      />
                    );
                  })}
                </div>
                <span className="chart-label">{new Date(start).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
          {groupBy && (
            <div className="chart-legend">
              {groups.map((g, i) => (
                <span className="legend-item" key={g}>
                  <span className="legend-swatch" style={{ background: COLORS[i % COLORS.length] }} />
                  {g}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
