import { useEffect, useState } from "react";
import { AggregateChart } from "./components/AggregateChart";
import { FilterBar } from "./components/FilterBar";
import { LogTable } from "./components/LogTable";
import { useAggregate } from "./hooks/useAggregate";
import { useLogs } from "./hooks/useLogs";
import { toLocalInputValue } from "./lib/datetime";
import type { BucketSize, GroupBy, SharedFilters } from "./types";

// GET /logs/aggregate requires since/until, so default to a range that works
// immediately instead of showing an empty chart on first load.
function defaultFilters(): SharedFilters {
  const until = new Date();
  const since = new Date(until.getTime() - 60 * 60_000);
  return {
    service: "",
    level: "",
    since: toLocalInputValue(since),
    until: toLocalInputValue(until),
    q: "",
    attrs: [],
  };
}

export default function App() {
  const [filters, setFilters] = useState<SharedFilters>(defaultFilters);
  const [bucket, setBucket] = useState<BucketSize>("1m");
  const [groupBy, setGroupBy] = useState<GroupBy>("");

  const { logs, nextCursor, loading: logsLoading, error: logsError, loadMore } = useLogs(filters);
  const { buckets, loading: aggLoading, error: aggError } = useAggregate(filters, bucket, groupBy);

  // No endpoint lists distinct services, so the filter's option list is built
  // from what's actually been seen — it only grows, so a service already
  // offered stays offered even after a filter narrows the current results.
  const [knownServices, setKnownServices] = useState<string[]>([]);
  useEffect(() => {
    if (logs.length === 0) return;
    setKnownServices((prev) => {
      const set = new Set(prev);
      let changed = false;
      for (const log of logs) {
        if (!set.has(log.service)) {
          set.add(log.service);
          changed = true;
        }
      }
      return changed ? [...set].sort() : prev;
    });
  }, [logs]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Log Dashboard</h1>
      </header>

      <FilterBar filters={filters} onChange={setFilters} services={knownServices} />

      <section className="panel">
        <h2>Log Volume Over Time</h2>
        <AggregateChart
          buckets={buckets}
          loading={aggLoading}
          error={aggError}
          bucket={bucket}
          groupBy={groupBy}
          onBucketChange={setBucket}
          onGroupByChange={setGroupBy}
        />
      </section>

      <section className="panel">
        <h2>Logs</h2>
        <LogTable
          logs={logs}
          loading={logsLoading}
          error={logsError}
          hasMore={nextCursor !== null}
          onLoadMore={loadMore}
        />
      </section>
    </div>
  );
}
