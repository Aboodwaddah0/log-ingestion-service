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

const BUCKET_UNIT_LABEL: Record<BucketSize, string> = {
  "1m": "1 min",
  "5m": "5 min",
  "1h": "1 hour",
  "1d": "1 day",
};

// A label under every column is unreadable once there are more than a
// handful of buckets, so only a spread-out subset gets a visible tick —
// the rest keep their exact time in the column's hover title.
const MAX_X_TICKS = 8;

function niceCeil(n: number): number {
  if (n <= 0) return 0;
  const pow = 10 ** Math.floor(Math.log10(n));
  const frac = n / pow;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return step * pow;
}

// SVG viewBox units — arbitrary, scaled to the container via CSS width/height.
const VB_W = 1000;
const VB_H = 300;

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

  // Round the axis ceiling to a "nice" number (25/50/100/...) instead of the
  // raw max, so the gridline labels are round and bars top out just under
  // full height rather than exactly one bar always touching the top.
  const niceMax = niceCeil(max);
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(niceMax * f));
  const xTickEvery = Math.max(1, Math.ceil(starts.length / MAX_X_TICKS));

  const xAt = (i: number) => (starts.length > 1 ? (i / (starts.length - 1)) * VB_W : VB_W / 2);
  const yAt = (count: number) => (niceMax > 0 ? VB_H - (count / niceMax) * VB_H : VB_H);

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
          <div className="chart-plot">
            <span className="chart-yaxis-title">Logs / {BUCKET_UNIT_LABEL[bucket]}</span>
            <div className="chart-yticks">
              {yTicks.map((v, i) => (
                <span key={i}>{v}</span>
              ))}
            </div>
            <div className="chart-bars-wrap">
              <div className="chart-svg-frame">
                <svg
                  className="chart-svg"
                  viewBox={`0 0 ${VB_W} ${VB_H}`}
                  preserveAspectRatio="none"
                >
                  {yTicks.map((_, i) => (
                    <line
                      key={i}
                      className="chart-gridline"
                      x1={0}
                      x2={VB_W}
                      y1={(VB_H * i) / (yTicks.length - 1)}
                      y2={(VB_H * i) / (yTicks.length - 1)}
                    />
                  ))}
                  {groups.map((g, gi) => {
                    const points = starts
                      .map((s, i) => `${xAt(i)},${yAt(matrix.get(s)?.get(g) ?? 0)}`)
                      .join(" ");
                    const color = COLORS[gi % COLORS.length];
                    return (
                      <g key={g}>
                        <polyline className="chart-line" points={points} stroke={color} />
                        {starts.map((s, i) => {
                          const count = matrix.get(s)?.get(g) ?? 0;
                          return (
                            <circle
                              key={s}
                              className="chart-point"
                              cx={xAt(i)}
                              cy={yAt(count)}
                              r={4}
                              fill={color}
                            >
                              <title>
                                {new Date(s).toLocaleString()} — {g}: {count}
                              </title>
                            </circle>
                          );
                        })}
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="chart-xticks">
                {starts.map((start, i) => (
                  <span
                    key={start}
                    className="chart-label"
                    style={{ left: `${(xAt(i) / VB_W) * 100}%` }}
                  >
                    {i % xTickEvery === 0 ? new Date(start).toLocaleTimeString() : ""}
                  </span>
                ))}
              </div>
              <span className="chart-xaxis-title">Time</span>
            </div>
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
