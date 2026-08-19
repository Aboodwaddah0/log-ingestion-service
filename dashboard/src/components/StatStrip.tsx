import { formatNumber, formatPercent } from "../lib/format";
import type { LevelSummary } from "../hooks/useLevelSummary";

interface Props {
  summary: LevelSummary;
  loading: boolean;
  serviceCount: number;
}

export function StatStrip({ summary, loading, serviceCount }: Props) {
  const errorRate = summary.total > 0 ? summary.byLevel.error / summary.total : 0;

  return (
    <div className="stat-strip" aria-label="Summary for the selected range" aria-busy={loading}>
      <div className="stat-tile">
        <span className="stat-label">Logs in range</span>
        <span className="stat-value">{loading ? "—" : formatNumber(summary.total)}</span>
      </div>
      <div className="stat-tile">
        <span className="stat-label">Error rate</span>
        <span className={`stat-value ${!loading && errorRate > 0 ? "stat-value-warn" : ""}`}>
          {loading ? "—" : formatPercent(errorRate)}
        </span>
      </div>
      <div className="stat-tile">
        <span className="stat-label">Errors</span>
        <span className="stat-value">{loading ? "—" : formatNumber(summary.byLevel.error)}</span>
      </div>
      <div className="stat-tile">
        <span className="stat-label">Warnings</span>
        <span className="stat-value">{loading ? "—" : formatNumber(summary.byLevel.warn)}</span>
      </div>
      <div className="stat-tile">
        <span className="stat-label">Services seen</span>
        <span className="stat-value">{formatNumber(serviceCount)}</span>
      </div>
    </div>
  );
}
