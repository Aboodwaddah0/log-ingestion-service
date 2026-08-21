import { useEffect, useState } from "react";
import { AggregateChart } from "./components/AggregateChart";
import { FilterBar } from "./components/FilterBar";
import { LogTable } from "./components/LogTable";
import { StatStrip } from "./components/StatStrip";
import { useAggregate } from "./hooks/useAggregate";
import { useLevelSummary } from "./hooks/useLevelSummary";
import { useLogs } from "./hooks/useLogs";
import { suggestBucket } from "./lib/bucket";
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
  const { summary, loading: summaryLoading } = useLevelSummary(filters);

  // A fixed default bucket looks like noise on a wide range (1,440 near-empty
  // 1m buckets over 24h), and grouping makes the same bucket worse (5 sparse
  // overlapping lines instead of 1) — re-suggest a readable one whenever the
  // range or the grouping changes. Doesn't refire just because the user picks
  // a bucket manually, so a manual choice sticks until either changes again.
  useEffect(() => {
    const since = new Date(filters.since).getTime();
    const until = new Date(filters.until).getTime();
    if (isNaN(since) || isNaN(until) || until <= since) return;
    setBucket(suggestBucket(until - since, groupBy !== ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.since, filters.until, groupBy]);

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
        <p className="app-subtitle">Search, filter, and chart ingested logs</p>
      </header>

      <StatStrip summary={summary} loading={summaryLoading} serviceCount={knownServices.length} />

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
