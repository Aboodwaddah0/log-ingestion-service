import type { TailItem, TailStatus } from "../hooks/useLiveTail";

interface Props {
  entries: TailItem[];
  status: TailStatus;
  enabled: boolean;
  onToggle: () => void;
  onClear: () => void;
}

const STATUS_LABEL: Record<TailStatus, string> = {
  idle: "Stopped",
  connecting: "Connecting…",
  open: "Live",
  error: "Reconnecting…",
};

export function LiveTail({ entries, status, enabled, onToggle, onClear }: Props) {
  return (
    <div className="live-tail">
      <div className="live-tail-controls">
        <button type="button" className={enabled ? "active" : ""} onClick={onToggle}>
          {enabled ? "Stop" : "Start"} live tail
        </button>
        {enabled && (
          <span className={`live-tail-status live-tail-status-${status}`} aria-live="polite">
            <span className="live-tail-dot" />
            {STATUS_LABEL[status]}
          </span>
        )}
        <span className="live-tail-count">{entries.length} received</span>
        <button type="button" onClick={onClear} disabled={entries.length === 0}>
          Clear
        </button>
      </div>

      <div className="log-table-wrap live-tail-feed">
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
          <tbody>
            {entries.map(({ seq, log }) => (
              <tr key={seq}>
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

        {enabled && entries.length === 0 && <p className="empty">Waiting for matching logs…</p>}
        {!enabled && (
          <p className="empty">Start live tail to stream new logs — matching the filters above — as they arrive.</p>
        )}
      </div>
    </div>
  );
}
