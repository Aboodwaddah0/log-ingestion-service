import type { LogEntry } from "../types";

interface Props {
  logs: LogEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function LogTable({ logs, loading, error, hasMore, onLoadMore }: Props) {
  const initialLoad = loading && logs.length === 0;

  return (
    <div className="log-table-wrap">
      {error && <div className="error-banner">{error}</div>}

      <table className="log-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Level</th>
            <th>Service</th>
            <th>Message</th>
            <th>Attributes</th>
          </tr>
        </thead>
        <tbody aria-busy={initialLoad}>
          {initialLoad &&
            Array.from({ length: 8 }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="skeleton-row" aria-hidden="true">
                <td colSpan={5}>
                  <div className="skeleton-block" />
                </td>
              </tr>
            ))}
          {logs.map((log) => (
            <tr key={log.id}>
              <td className="ts">{new Date(log.timestamp).toLocaleString()}</td>
              <td>
                <span className={`badge badge-${log.level}`}>{log.level}</span>
              </td>
              <td>{log.service}</td>
              <td className="message">{log.message}</td>
              <td className="attrs-cell">
                {Object.entries(log.attributes).map(([k, v]) => (
                  <span className="attr-chip" key={k}>
                    {k}={String(v)}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {logs.length === 0 && !loading && !error && <p className="empty">No logs match these filters.</p>}

      <div className="table-footer">
        {loading && <span>Loading…</span>}
        {!loading && hasMore && (
          <button type="button" onClick={onLoadMore}>
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
