import { toLocalInputValue } from "../lib/datetime";
import type { AttributeFilter, LogLevel, SharedFilters } from "../types";

interface Props {
  filters: SharedFilters;
  onChange: (filters: SharedFilters) => void;
  services: string[];
}

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

function applyQuickRange(minutes: number, filters: SharedFilters, onChange: Props["onChange"]) {
  const until = new Date();
  const since = new Date(until.getTime() - minutes * 60_000);
  onChange({ ...filters, since: toLocalInputValue(since), until: toLocalInputValue(until) });
}

// Purely a visual affordance — compares the current range's *duration* to
// each preset so the matching quick-range button reads as selected. Doesn't
// try to confirm `until` is exactly "now"; a manually-entered range that
// happens to span 60 minutes will also show "1h" as active, which is fine.
function activeQuickRangeMinutes(filters: SharedFilters): number | null {
  if (!filters.since || !filters.until) return null;
  const since = new Date(filters.since).getTime();
  const until = new Date(filters.until).getTime();
  if (isNaN(since) || isNaN(until)) return null;
  return Math.round((until - since) / 60_000);
}

export function FilterBar({ filters, onChange, services }: Props) {
  const setField = <K extends keyof SharedFilters>(key: K, value: SharedFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const setAttr = (index: number, patch: Partial<AttributeFilter>) => {
    const attrs = filters.attrs.map((a, i) => (i === index ? { ...a, ...patch } : a));
    onChange({ ...filters, attrs });
  };

  const addAttr = () => onChange({ ...filters, attrs: [...filters.attrs, { key: "", value: "" }] });
  const removeAttr = (index: number) =>
    onChange({ ...filters, attrs: filters.attrs.filter((_, i) => i !== index) });

  const activeMinutes = activeQuickRangeMinutes(filters);

  return (
    <div className="filter-bar" role="search" aria-label="Log filters">
      <div className="filter-row">
        <label>
          Service
          <select value={filters.service} onChange={(e) => setField("service", e.target.value)}>
            <option value="">all</option>
            {services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {filters.service && !services.includes(filters.service) && (
              <option value={filters.service}>{filters.service}</option>
            )}
          </select>
        </label>
        <label>
          Level
          <select
            value={filters.level}
            onChange={(e) => setField("level", e.target.value as SharedFilters["level"])}
          >
            <option value="">all</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Search message
          <input
            value={filters.q}
            onChange={(e) => setField("q", e.target.value)}
            placeholder="declined"
          />
        </label>
      </div>

      <div className="filter-row">
        <label>
          Since
          <input
            type="datetime-local"
            value={filters.since}
            onChange={(e) => setField("since", e.target.value)}
          />
        </label>
        <label>
          Until
          <input
            type="datetime-local"
            value={filters.until}
            onChange={(e) => setField("until", e.target.value)}
          />
        </label>
        <div className="quick-ranges" role="group" aria-label="Quick time range">
          <button
            type="button"
            className={activeMinutes === 15 ? "active" : ""}
            aria-pressed={activeMinutes === 15}
            onClick={() => applyQuickRange(15, filters, onChange)}
          >
            15m
          </button>
          <button
            type="button"
            className={activeMinutes === 60 ? "active" : ""}
            aria-pressed={activeMinutes === 60}
            onClick={() => applyQuickRange(60, filters, onChange)}
          >
            1h
          </button>
          <button
            type="button"
            className={activeMinutes === 24 * 60 ? "active" : ""}
            aria-pressed={activeMinutes === 24 * 60}
            onClick={() => applyQuickRange(24 * 60, filters, onChange)}
          >
            24h
          </button>
        </div>
      </div>

      <div className="filter-row attrs">
        <span className="attrs-label">Attributes</span>
        {filters.attrs.map((attr, i) => (
          <div className="attr-pair" key={i}>
            <input
              aria-label={`attribute ${i + 1} key`}
              placeholder="key"
              value={attr.key}
              onChange={(e) => setAttr(i, { key: e.target.value })}
            />
            <input
              aria-label={`attribute ${i + 1} value`}
              placeholder="value"
              value={attr.value}
              onChange={(e) => setAttr(i, { value: e.target.value })}
            />
            <button type="button" onClick={() => removeAttr(i)} aria-label="remove attribute filter">
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={addAttr}>
          + attribute
        </button>
      </div>
    </div>
  );
}
