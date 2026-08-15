import { useState } from "react";
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>Log Dashboard</h1>
      </header>

      <FilterBar filters={filters} onChange={setFilters} />

      <section className="panel">
        <h2>Volume over time</h2>
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
