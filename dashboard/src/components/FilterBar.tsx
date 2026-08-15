import { toLocalInputValue } from "../lib/datetime";
import type { AttributeFilter, LogLevel, SharedFilters } from "../types";

interface Props {
  filters: SharedFilters;
  onChange: (filters: SharedFilters) => void;
}

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

function applyQuickRange(minutes: number, filters: SharedFilters, onChange: Props["onChange"]) {
  const until = new Date();
  const since = new Date(until.getTime() - minutes * 60_000);
  onChange({ ...filters, since: toLocalInputValue(since), until: toLocalInputValue(until) });
}

export function FilterBar({ filters, onChange }: Props) {
  const setField = <K extends keyof SharedFilters>(key: K, value: SharedFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const setAttr = (index: number, patch: Partial<AttributeFilter>) => {
    const attrs = filters.attrs.map((a, i) => (i === index ? { ...a, ...patch } : a));
    onChange({ ...filters, attrs });
  };

  const addAttr = () => onChange({ ...filters, attrs: [...filters.attrs, { key: "", value: "" }] });
  const removeAttr = (index: number) =>
    onChange({ ...filters, attrs: filters.attrs.filter((_, i) => i !== index) });

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <label>
          Service
          <input
            value={filters.service}
            onChange={(e) => setField("service", e.target.value)}
            placeholder="checkout"
          />
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
        <div className="quick-ranges">
          <button type="button" onClick={() => applyQuickRange(15, filters, onChange)}>
            15m
          </button>
          <button type="button" onClick={() => applyQuickRange(60, filters, onChange)}>
            1h
          </button>
          <button type="button" onClick={() => applyQuickRange(24 * 60, filters, onChange)}>
            24h
          </button>
        </div>
      </div>

      <div className="filter-row attrs">
        <span className="attrs-label">Attributes</span>
        {filters.attrs.map((attr, i) => (
          <div className="attr-pair" key={i}>
            <input
              placeholder="key"
              value={attr.key}
              onChange={(e) => setAttr(i, { key: e.target.value })}
            />
            <input
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
