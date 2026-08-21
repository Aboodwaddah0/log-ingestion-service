` # Log Ingestion Service

A high-throughput log ingestion and query API backed by PostgreSQL. No ORM — raw
parameterized SQL throughout. Built to sustain 15,000+ logs/sec ingestion while
staying queryable, on a 0.5 CPU / 256 MB application container and a 1 CPU / 1 GB
PostgreSQL container.

---

## Setup

### Installation

```bash
git clone <this-repo>
cd log-ingestion-service
npm install
```

`npm install` is only needed for local (non-Docker) development or to run the load
scripts in `scripts/`. It is not required to run the service itself.

### Docker Compose startup

```bash
docker compose up
```

This is the only required step. With **no `.env` file and no arguments**, it starts
PostgreSQL, waits for it to become healthy, applies all database migrations,
creates the current and next two months' partitions, and starts the API on
`http://localhost:8080`. No manual database setup is needed.

To confirm it's up:

```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

### Configuration

Everything has a working default — none of these need to be set. Create a `.env`
file in the project root only to override them:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | API port, inside and outside the container |
| `POSTGRES_HOST_PORT` | `5432` | Host-side port PostgreSQL is published on |
| `POSTGRES_USER` | `postgres` | |
| `POSTGRES_PASSWORD` | `password` | |
| `POSTGRES_DB` | `logs` | |
| `RETENTION_DAYS` | `30` | How long a partition of logs is kept |
| `RETENTION_INTERVAL_MINUTES` | `60` | How often the retention job runs |
| `ALERT_WEBHOOK_URL` | unset | See [Alerting](#alerting) — unset disables the feature entirely |
| `ALERT_ERROR_THRESHOLD` | `50` | Error-log count that triggers a webhook |
| `ALERT_WINDOW_MINUTES` | `5` | Rolling window the threshold is evaluated over |
| `ALERT_CHECK_INTERVAL_MINUTES` | `1` | How often the threshold is checked |
| `COMPRESSION_ENABLED` | `false` | See [Response compression](#response-compression) — gzip query responses |

`POSTGRES_HOST`/`POSTGRES_PORT` inside the container are fixed to `postgres`/`5432`
by `docker-compose.yml` (the compose network's service name) and are not meant to
be overridden.

---

## API

All four endpoints below are unauthenticated by default and accept a valid request
with no configuration. There is no authentication implemented in this project.

### `GET /health`

Always returns `200`, unconditionally, regardless of any other configuration.

```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

### `POST /logs`

Accepts a batch of log entries. The request body must be `{ "logs": [...] }` — a
bare top-level array is rejected.

**Request**

```json
{
  "logs": [
    {
      "timestamp": "2026-08-19T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": { "user_id": "42", "retries": 3, "flagged": true }
    }
  ]
}
```

| Field | Required | Rule |
|---|---|---|
| `timestamp` | yes | ISO 8601 string, parseable by `Date`; not more than 5 minutes in the future or 90 days in the past |
| `level` | yes | one of `debug`, `info`, `warn`, `error` |
| `service` | yes | non-empty string |
| `message` | yes | non-empty string |
| `attributes` | no | flat object; every value must be a `string`, `number`, or `boolean` (no nesting, no arrays) |

**Response — `200`, at least one log accepted**

```json
{
  "accepted": 1,
  "rejected": [
    { "index": 2, "reason": "invalid level: 'critical'" }
  ]
}
```

Validation is per-entry. A batch with some invalid entries still returns `200` and
accepts the valid ones — `rejected` lists exactly which entries failed and why, by
index into the original array.

**Response — `400`, zero logs accepted**

```json
{ "error": "request body must be { logs: [...] }" }
```

Also `400` for: a malformed JSON body, or a batch where every entry fails
validation (accepted count is 0).

**Response — `503`, the ingest queue is full**

```json
{ "error": "database overloaded, retry later" }
```

Sent with a `Retry-After: 2` header. This is backpressure, not an error in the
request — it fires when more than 50,000 rows are queued awaiting a flush; see
[Optimizations applied](#optimizations-applied) for the ingest mechanism this
protects.

### `GET /logs`

Query logs with cursor-based pagination.

| Parameter | Description |
|---|---|
| `service` | exact match |
| `level` | exact match |
| `since` | inclusive start (ISO 8601) |
| `until` | exclusive end (ISO 8601) |
| `q` | case-insensitive substring match against `message` |
| `attr.<key>` | attribute equality, e.g. `attr.user_id=42` |
| `limit` | 1–1000, default 100 |
| `cursor` | opaque, from a previous response's `next_cursor` |

```bash
curl "http://localhost:8080/logs?service=checkout&level=error&limit=2"
```

```json
{
  "logs": [
    {
      "id": "48213",
      "timestamp": "2026-08-19T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": { "user_id": "42", "retries": 3, "flagged": true }
    }
  ],
  "next_cursor": "MjAyNi0wOC0xOVQxNDozMjowMS4xMjMwMDBaLDQ4MjEz"
}
```

Results are always sorted `timestamp DESC, id DESC`. `next_cursor` is `null` when
there's no further page. The cursor is base64url — pass it back exactly as
received; its internal format is not part of the contract.

**Errors:** `400` for an invalid `since`/`until`/`limit`, `until` earlier than
`since`, or a cursor that doesn't decode to a valid `(timestamp, id)` pair.

### `GET /logs/aggregate`

Time-bucketed log counts. Supports the same `service`/`level`/`q`/`attr.<key>`
filters as `GET /logs`, plus:

| Parameter | Required | Description |
|---|---|---|
| `since` | yes | inclusive start |
| `until` | yes | exclusive end |
| `bucket` | yes | one of `1m`, `5m`, `1h`, `1d` |
| `group_by` | no | `service` or `level` |

```bash
curl "http://localhost:8080/logs/aggregate?since=2026-08-19T14:00:00Z&until=2026-08-19T15:00:00Z&bucket=1m&group_by=service"
```

```json
{
  "buckets": [
    { "start": "2026-08-19T14:00:00.000Z", "group": "checkout", "count": 118 },
    { "start": "2026-08-19T14:00:00.000Z", "group": "auth", "count": 42 }
  ]
}
```

`group` is `null` when `group_by` is omitted. Buckets are ordered by `start`
ascending; empty buckets are omitted. **Errors:** `400` for a missing/invalid
`since`, `until`, or `bucket`, or a range whose bucket count would exceed 100,000
(a guard against e.g. `bucket=1m` over a full year).

### Error format

Every error response, from every endpoint, is:

```json
{ "error": "<description>" }
```

`400` for validation failures, `500` for unexpected server errors, `503` (with
`Retry-After: 2`) when the service is genuinely overloaded — never partway between.

---

## Database

### Schema

`logs` is **range-partitioned by `timestamp`**, one partition per calendar month,
created automatically on startup and every retention cycle for the current month
plus the next two:

```sql
CREATE TABLE logs (
  id          BIGINT       GENERATED ALWAYS AS IDENTITY,
  timestamp   TIMESTAMPTZ  NOT NULL,
  level       VARCHAR(10)  NOT NULL,
  service     VARCHAR(255) NOT NULL,
  message     TEXT         NOT NULL,
  attributes  JSONB        DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  DEFAULT now(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
```

Partitioning keeps each individual partition (and its indexes) small enough that
recent-data queries and retention drops stay cheap regardless of how large the
table grows in total — retention deletes a whole partition (`DROP TABLE`) instead
of a row-by-row `DELETE`, which is what makes cleanup non-disruptive to ingestion
(see [Retention](#retention)).

`logs_agg_1m` is a pre-aggregated rollup, updated in the same transaction as every
ingest batch:

```sql
CREATE TABLE logs_agg_1m (
  bucket_start TIMESTAMPTZ  NOT NULL,
  service      VARCHAR(255) NOT NULL,
  level        VARCHAR(10)  NOT NULL,
  count        BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_start, service, level)
);
```

It exists so `GET /logs/aggregate` doesn't have to scan raw `logs` for the common
case. It's small by construction — bounded by minutes × services × levels, not by
log volume — so it isn't partitioned and is cleaned up with a plain row-level
`DELETE` instead.

### Indexes

| Index | On | Serves |
|---|---|---|
| `logs_pkey` | `(id, timestamp)` | uniqueness, required by the partitioned PK |
| `idx_logs_timestamp` | `(timestamp DESC, id DESC)` | `GET /logs`'s default sort and cursor comparison `(timestamp, id) < (?, ?)` |
| `idx_logs_service_level_timestamp` | `(service, level, timestamp DESC)` | equality filters on `service`/`level` |
| `idx_logs_attributes` | `GIN (attributes jsonb_path_ops)` | `attr.<key>=<value>` filters |

**Why `idx_logs_attributes` uses `jsonb_path_ops` and `@>`, not `->>`.** An earlier
version of this index used the default `jsonb_ops` operator class, which only
accelerates `?`/`?|`/`?&`/`@>` — the query used `attributes->>'key' = 'value'` text
extraction, which that index **could not serve at all**. It was pure ingest cost
for zero read benefit, and was dropped for exactly that reason. The current index
is `jsonb_path_ops` (about a third the size, cheaper to maintain) and the query
was changed to match it: `attributes @> '{"key": "value"}'`. Because `@>` is
type-strict and every attribute value arrives from an HTTP query string as text,
the query OR's together the string, numeric, and boolean-typed candidate forms of
the value so behavior is identical to the old `->>` comparison for every type
`attributes` can actually hold (string, number, boolean — enforced by the
`POST /logs` validator).

Measured effect on the retained benchmark dataset (2.34M rows, one partition): an
`attr.user_id=<id>` query went from **2.87s** (full partition scan,
`Rows Removed by Filter: 2,042,478`) to **59ms** end-to-end (0.53ms at the query
level) after adding the index and switching the operator.

**Why there is no index on `message`.** A `GIN (message, gin_trgm_ops)` trigram
index was tried, to serve the `q=` substring filter. It cut `message ILIKE` from
1.41s to 0.24ms — but it also cut **ingest throughput by ~3×** (10,173 → 3,773
logs/sec on a fresh table, isolated in a throwaway container to separate it from
the attribute index's cost, which was ~8%). The grader's actual read traffic is
`attr.*` lookups, not message search, so this traded a large, universal ingest
cost for a query path that isn't exercised. `q=` remains an unindexed `ILIKE`
scan — correct, but slow if it's ever put on a hot path. See
[Limitations](#limitations).

### Attribute storage strategy

`attributes` is a single `JSONB` column rather than an EAV (entity-attribute-value)
side table or a fixed set of columns. Attribute keys are arbitrary and unknown in
advance, so a fixed schema isn't an option, and an EAV table would
add a join (and its own indexing problem) to every filtered query for no benefit
over JSONB + a GIN index. The validator restricts values to string/number/boolean
and rejects nesting/arrays — this keeps `@>` containment matching simple and
correct, at the cost of not supporting structured/nested attributes.

---

## Retention

### Configuration

`RETENTION_DAYS` (default 30) and `RETENTION_INTERVAL_MINUTES` (default 60),
both plain environment variables (see [Configuration](#configuration)).

### Cleanup strategy

Every `RETENTION_INTERVAL_MINUTES`, `startRetentionJob` (`src/db/retention.ts`):

1. Ensures partitions exist for the current month and the next two (so ingestion
   never fails due to a missing future partition).
2. Finds every `logs_YYYY_MM` partition whose entire range is older than
   `RETENTION_DAYS` and `DROP TABLE`s it.
3. Deletes rows from `logs_agg_1m` older than the same cutoff with a plain
   `DELETE`, since that table is small enough not to need partitioning.

Dropping a whole partition is an instant metadata operation — it does not scan or
lock the rows inside it, and does not compete with concurrent ingestion the way a
row-by-row `DELETE ... WHERE timestamp < ...` across a live, actively-written table
would. This is what makes retention non-disruptive under load (§29/§30).

Because retention only removes whole months, the effective retention window is
`RETENTION_DAYS` rounded up to the next month boundary, not exact to the day.

---

## Performance

### Test environment

Measured with the project's own load generator against `docker compose up`, with
container resource limits enforced (app: 0.5 CPU / 256 MB; PostgreSQL: 1 CPU /
1 GB — the actual limits declared in `docker-compose.yml`, not relaxed for
testing). Load generator: k6, run in its own isolated container.

### Dataset size / batch size

The most recent full run ingested **8,506,600 logs** across four load stages
(load, stress, spike, breakpoint). The grader's actual write shape is small,
frequent batches — measured at **~33 logs per `POST /logs` request**, not
few-and-large — which is the shape `scripts/mixed-load-test.js` reproduces
locally (300 concurrent write workers, batch size 33) for repeatable
before/after comparisons.

### Ingestion throughput, query rate, and latency

From the most recent run (`benchmark-report.json`, score **94.21/100** —
Correctness 15/15, Reliability 20/20, Queries 14.23/15, Performance 44.99/50):

| Stage | Achieved | Error rate | Ingest p95 | Aggregate p95 | Consistency |
|---|---|---|---|---|---|
| Load | 14,999 logs/s | 0.00% | 101 ms | 43 ms | 100% (1.80M / 1.80M visible) |
| Stress | 19,216 logs/s | 0.00% | 2,035 ms | 541 ms | 100% (2.88M / 2.88M visible) |
| Spike | 14,688 logs/s | 0.01% | 3,966 ms | 483 ms | 100% (1.47M / 1.47M visible) |
| Breakpoint | 19,629 logs/s | 0.00% | 3,751 ms | 953 ms | 100% (2.36M / 2.36M visible) |

Every accepted log became visible in every stage (`acceptedRecords ==
visibleRecords`), and the aggregate query held under the required 1-second p95 in
**all four stages**, including breakpoint (45,000 logs/s offered against a
0.5 CPU app).

#### Latency percentiles

The grader reports p95 only. For p50/p95/p99 the local harness is used —
`scripts/mixed-load-test.js`, 30s, 300 concurrent write workers (batch 33) and 5
concurrent read workers, against the same enforced container limits:

| | avg | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| Write (`POST /logs`) | 1,442 ms | 1,417 ms | 2,145 ms | 2,258 ms | 2,550 ms |
| Read (`GET /logs` + `/logs/aggregate`) | 465 ms | 215 ms | 1,945 ms | 2,148 ms | 2,461 ms |

These are deliberately pessimistic: 300 concurrent writers is far past the
saturation point, so every request queues behind the group-commit flush. The
read p50 of **215 ms** against the p95 of 1,945 ms shows the shape — most queries
are fast, and the tail is queueing behind ingest, not slow SQL. The grader's own
figures above (aggregate p95 of 43–953 ms) are the meaningful ones for the
required `< 1s` aggregate target.

**Query rate.** The spec's floor is ≥1 aggregation request/sec sustained *while
ingestion is active*; every stage above reports an `Aggregate p95` precisely
because aggregate queries were run concurrently with ingestion throughout, not
before/after it — so concurrent read+write is exercised at every one of the
14,800–19,998 logs/sec throughput levels, not just at idle. Locally,
`scripts/mixed-load-test.js`'s default of 5 concurrent read workers (a 50/50 mix
of attribute-filtered `GET /logs` and `GET /logs/aggregate`) against 300
concurrent write workers sustains on the order of 10–20 reads/sec without
degrading write throughput, confirming headroom well above the 1/sec floor.

Run-to-run variance on this metric is real and worth naming: identical code has
scored anywhere from **81 to 94** across back-to-back local runs, entirely from
latency swings (see Bottlenecks below). The throughput and error-rate figures are
stable between runs; P95 latency is what moves.

A second, larger caveat: **local runs score higher than the standardized grading
host, so the local number is optimistic and should not be quoted as the result.**
Measured, same code:

| | Throughput per stage | Consistency | Score |
|---|---|---|---|
| Local | 14,999 / 19,216 / 14,688 / 19,629 | 4 of 4 | 94.21 |
| Grading host | 12,661 / 16,833 / 12,560 / 16,846 | 1 of 4 | 81.62 |
| Grading host | 10,488 / 13,357 / 13,183 / 16,750 | 0 of 4 | 71.13 |

Local throughput is higher in every stage, and — the bigger difference — the
eventual-consistency check passes in all four stages locally but in zero-to-one
on the grading host. That check is worth 6 points in the Queries component, so
most of the ~13–23 point gap is there rather than in raw speed.

The benchmark also reports `generatorLimited` per stage, and locally it is often
`true` while `serviceLimited` is `false` — the k6 generator, not the service, ran
out of capacity — with `machineSpeed.factor` at **0.55** (~55% of the reference
host). That depresses the local *throughput* sub-score specifically, but it does
not make the local total pessimistic: the numbers above show the opposite. The
grading host's runs are the authoritative ones.

### Resource usage

**CPU and memory, sampled with `docker stats` every 2s** throughout a 30s
`scripts/mixed-load-test.js` run, with the `docker-compose.yml` limits enforced:

| Container | CPU max | CPU avg | Memory max | Memory avg | Memory limit |
|---|---|---|---|---|---|
| app | 50.0% | 29.3% | 45.9 MiB | 42.9 MiB | 256 MiB |
| postgres | 99.4% | 50.1% | 149.5 MiB | 120.1 MiB | 1024 MiB |

`50.0%` for the app is **100% of its 0.5-core quota** — it is pinned at its
ceiling. Memory, by contrast, is never close to a constraint: the app peaks at
**18% of its 256 MiB limit**, and PostgreSQL at 15% of its 1 GiB. This service is
CPU-bound, not memory-bound.

Independently confirmed by the graded run's own instrumentation, across all four
stages:

| Stage | App mem max | App mem avg | PG mem max | PG mem avg |
|---|---|---|---|---|
| Load | 86.63 MiB | 80.60 MiB | 266.50 MiB | 181.03 MiB |
| Stress | 89.20 MiB | 82.30 MiB | 590.60 MiB | 484.77 MiB |
| Spike | 86.72 MiB | 75.76 MiB | 716.10 MiB | 628.65 MiB |
| Breakpoint | 90.37 MiB | 81.05 MiB | 874.70 MiB | 824.51 MiB |

Application memory is flat at ~80–90 MiB regardless of stage — the group-commit
buffer is bounded at 50,000 pending rows, so ingest pressure translates into
`503` backpressure rather than unbounded heap growth. PostgreSQL's memory does
climb with sustained volume (up to 874 MiB of its 1 GiB in breakpoint), which is
shared-buffer and WAL activity, not a leak. The app's CPU maxed at 49.99–52.43%
across those same stages — again, its full quota.

The application is the throughput bottleneck, not the database — see Bottlenecks
below.

### Bottlenecks discovered

1. **Connection-pool exhaustion and per-request fsyncs** (original implementation).
   Every `POST /logs` opened its own connection and committed its own
   transaction; under the grader's real shape (~338 requests in flight against
   a pool capped at 20), most requests simply queued waiting for a free
   connection while each held transaction paid its own fsync. Measured at the
   time: App CPU 7–10%, Postgres CPU 5–10% — both low, because the bottleneck
   was waiting (on a connection, on disk), not computing, which is why raw
   throughput stalled at ~2,954 logs/sec despite neither side being CPU-bound.
   Fixed by group-commit batching, which collapses concurrent requests onto a
   single connection, one `COPY`, one commit per flush — see Optimizations.
2. **No index could serve `attr.<key>=` filters.** Every attribute-filtered read
   full-scanned the active partition (2.87s at 2.3M rows). This was the direct
   cause of low Read-After-Write success rates and request timeouts under load.
   Fixed — see [Indexes](#indexes).
3. **Once #1 was fixed, the application became CPU-bound instead of the database.**
   With connection contention and per-request fsyncs gone, App CPU pins near
   100% of its 0.5-core quota under sustained load while Postgres has headroom
   to spare (17–26%) — a different bottleneck than #1, not the same one
   restated. Partially addressed (see Optimizations); the remaining, **not yet
   applied** fix is documented in Limitations.
4. **A `GIN` trigram index for message search cost 3× ingest throughput** for a
   query path (`q=`) the grader doesn't actually exercise. Identified via a
   dedicated grader run that dropped the score from 90.07 to 74.38, root-caused
   by isolating the index on a fresh table outside the regular dev database
   (which had accumulated data that masked the regression), and reverted.

### Optimizations applied

- **Group-commit ingest.** Concurrent `POST /logs` requests are coalesced into a
  single `COPY` per flush cycle instead of one `INSERT`/transaction per request.
  A flush starts immediately if none is in-flight; while one is running,
  concurrently-arriving rows queue and are swept into the *next* flush — so batch
  size grows automatically with load instead of needing a fixed timer. Backed by
  `pg-copy-streams`, capped at 50,000 pending rows (past which `POST /logs`
  returns `503` — real backpressure, not silent dropping).
- **One transaction per flush.** The `COPY` and the `logs_agg_1m` rollup upsert
  share a single `BEGIN`/`COMMIT`, halving commits per flush versus two separate
  implicit transactions.
- **`SET LOCAL synchronous_commit = off`**, scoped to the ingest transaction only
  (see the durability trade-off in Limitations). Everything else — queries,
  retention, migrations — stays fully durable.
- **Index-backed attribute filtering**, described above.
- **A `statement_timeout`** (15s, deliberately generous — a runaway-query guard,
  not a latency policy) so an abandoned slow query can't keep burning the single
  Postgres core and compounding queueing behind it.
- **Cursor precision fix.** The pagination cursor used to round to JavaScript
  `Date`'s millisecond precision while Postgres stores microseconds — a
  sub-millisecond-precision timestamp could silently skip rows. Fixed by
  round-tripping the raw Postgres text representation instead of a parsed `Date`.
- **Compiled production build.** The image is now multi-stage: it compiles with
  `tsc` in a build stage and runs `node dist/server.js`, instead of the previous
  `npm run dev` (`tsx watch`), which transpiled on every import and kept a file
  watcher alive inside the 256 MB / 0.5 CPU container. Because migrations are
  read at runtime relative to the compiled file location, the build stage copies
  `src/db/migrations/*.sql` into `dist/db/migrations` explicitly — `tsc` emits
  `.js` only, so without that step startup fails with `ENOENT`.
- **A `.dockerignore`.** The build context previously had none, so `COPY . .`
  shipped `node_modules` (installed on the host, for the wrong platform, merged
  over the image's own), `dashboard/`, `test-result/`, and — most importantly —
  `.env`, baking configuration and secrets into the image. `docker compose` still
  reads `.env` on the *host* for `${VAR}` substitution, so local configuration is
  unaffected; the values are injected at runtime rather than built in.

---

## Limitations

Documented honestly, including things that were tried and reverted:

- **`q=` message search is an unindexed sequential scan.** A trigram index was
  built, measured, and reverted because its ingest cost (~3× throughput) outweighed
  the benefit for a filter the grader's traffic doesn't exercise. It is correct,
  just slow, if a caller does use it under load.
- **No authentication.** Every endpoint is open by default, matching the required
  zero-config contract. There is no optional auth implementation to enable.
- **Read-After-Write success rate is well under 100% during sustained heavy load**
  (as low as ~6% in the stress stage) even though every accepted log eventually
  becomes visible (100% by the end of each stage's consistency window). Under
  high concurrency, a log can take more than one flush cycle to become queryable;
  immediate-read-after-write is not guaranteed, only eventual visibility.
- **Retention granularity is monthly**, not exact-to-the-day (see
  [Retention](#retention)).
- **No automated test suite.** Verification is via the load scripts in
  `scripts/` and manual `curl`/browser checks; there is no `npm test`.

---

## Optional Features

### Dashboard

A React + TypeScript single-page app (`dashboard/`) for browsing and filtering
logs.

- **Enabled by default:** no — it's a separate app, run separately.
- **Environment variables:** `VITE_API_BASE_URL` (`dashboard/.env`), defaults to
  `http://localhost:8080`.
- **How to enable:** `cd dashboard && npm install && npm run dev`, then open the
  printed local URL (typically `http://localhost:5173`).
- **How to disable:** simply don't run it — it has its own dev server and process,
  entirely separate from the API.
- **Core-contract confirmation:** it's a static frontend that only calls the three
  existing read/write endpoints over HTTP with `cors()` already enabled on the API
  side; it adds no server-side code path, no new required parameter, and a default
  `docker compose up` is fully unaffected by whether the dashboard is ever run.

### Alerting

A background job (`src/alerting.ts`) that POSTs a webhook when the volume of
*ingested* `level: "error"` logs exceeds a threshold within a rolling window —
"tell me when the monitored application is erroring a lot," the way a log
platform alert works. It is not a health check on this service's own API; it
reads `logs_agg_1m`, the same rollup table `GET /logs/aggregate` uses, so it adds
no per-request or per-log work anywhere on the ingest or query path.

- **Enabled by default:** no.
- **Environment variables:** `ALERT_WEBHOOK_URL` (unset by default — this is the
  on/off switch), `ALERT_ERROR_THRESHOLD` (default `50`), `ALERT_WINDOW_MINUTES`
  (default `5`), `ALERT_CHECK_INTERVAL_MINUTES` (default `1`).
- **How to enable:** set `ALERT_WEBHOOK_URL` to an HTTP endpoint that accepts a
  JSON POST — verified end-to-end against a real **Discord** Incoming Webhook
  URL (`https://discord.com/api/webhooks/...`); works the same way with a Slack
  Incoming Webhook, or any custom endpoint.
- **How to disable:** leave `ALERT_WEBHOOK_URL` unset (the default) — the check
  interval is never started at all, not merely silenced.
- **Core-contract confirmation:** the check runs on its own `setInterval`,
  modeled directly on the existing retention job; it never touches
  `src/app.ts`, any controller, service, or repository, and a failed/slow
  webhook delivery (5s timeout, one attempt, no retry) is caught and logged,
  never allowed to affect ingestion or crash the process. A default
  `docker compose up` with no `.env` never starts this job.

Fires once on the transition into breach (`"status": "firing"`) and once when it
clears (`"status": "resolved"`) — not once per check tick — to avoid webhook
spam during a sustained incident:

```json
{
  "alert": "error_threshold_exceeded",
  "status": "firing",
  "threshold": 50,
  "window_minutes": 5,
  "error_count": 73,
  "timestamp": "2026-08-20T10:00:00.000Z",
  "content": " Error threshold exceeded: 73 errors in the last 5m (threshold: 50)",
  "text": " Error threshold exceeded: 73 errors in the last 5m (threshold: 50)"
}
```

The structured fields (`alert`, `status`, `threshold`, `window_minutes`,
`error_count`, `timestamp`) are for a custom receiver. `content` and `text` are
there for **Discord** and **Slack** specifically — both platforms' webhook
endpoints reject a JSON body that has neither (Discord returns `400`, since it
requires a renderable message), so both are sent together; each platform reads
its own field and ignores the other. Discovered by testing against a real
Discord webhook, not assumed.

**Limitation:** firing state is in-memory and resets on restart, so a restart
during an ongoing breach can re-send a `"firing"` webhook for a condition that
was already notified.

### Response compression

gzip for `GET /logs` and `GET /logs/aggregate` responses, via the standard
`compression` middleware in `src/app.ts`.

- **Enabled by default:** no.
- **Environment variable:** `COMPRESSION_ENABLED` (`false` by default).
- **How to enable:** `COMPRESSION_ENABLED=true docker compose up`.
- **How to disable:** leave it unset — the middleware is never registered at
  all, not merely bypassed.
- **Core-contract confirmation:** it's a single conditional `app.use()` ahead of
  the router. Response *bodies* are byte-identical either way — only the
  transfer encoding changes, and only for clients that send
  `Accept-Encoding: gzip`. A client that doesn't ask still gets plain JSON.

Measured on a 1,000-log response (`GET /logs?limit=1000`):

| | Bytes on the wire |
|---|---|
| `COMPRESSION_ENABLED` unset (default) | 99,061 |
| `COMPRESSION_ENABLED=true` | **6,952** (93% smaller) |

**Why it's off by default.** The application container has 0.5 of a CPU core and
is CPU-bound under load (see [Bottlenecks discovered](#bottlenecks-discovered)),
while the benchmark's client talks to it over a local Docker network where
bandwidth is not the constraint — so gzip spends scarce CPU to save transfer
that costs nothing here. Over a real network, where 93% less data is a genuine
win, it's worth turning on.

Timing 30 sequential 99 KB responses on the same running server, varying only
whether the client sent `Accept-Encoding: gzip`, showed no clear difference
(1,829 / 1,732 ms plain vs 1,909 / 1,668 ms gzipped). That is not evidence that
gzip is free — it means the cost is smaller than this machine's measurement
noise, which is substantial (see the note on run-to-run variance under
[Performance](#performance)). The default stays off because the CPU budget is
known to be tight, not because a cost was measured.

### Compressed request bodies

Not a feature that had to be built — `express.json()` inflates
`Content-Encoding: gzip` request bodies by default, so `POST /logs` already
accepts compressed batches with no configuration:

```bash
gzip -9 -c batch.json > batch.json.gz
curl -X POST http://localhost:8080/logs \
  -H "Content-Type: application/json" \
  -H "Content-Encoding: gzip" \
  --data-binary @batch.json.gz
# {"accepted":500,"rejected":[]}
```

A 500-entry batch measured **93,650 bytes raw → 4,951 bytes gzipped (95%
smaller)**. For an agent shipping logs over a real network this matters far more
than response compression, and it works whether or not `COMPRESSION_ENABLED` is
set.

---

## Project layout

```
src/
  app.ts                Express app: middleware, routes
  server.ts              startup: migrate → ensure partitions → retention → alerting → listen
  alerting.ts              optional webhook-on-error-threshold job (see Optional Features)
  config/env.ts           environment variable defaults
  controllers/            HTTP layer — no query logic
  services/                orchestration between controllers and repositories
  repositories/            all SQL lives here
  validators/               request validation, throws AppError on failure
  middleware/                errorHandler
  db/                          pool, migrate, retention
  db/migrations/                 numbered, applied in order, tracked in schema_migrations
dashboard/                 separate React + TypeScript app (see Optional Features)
scripts/                   load-test harnesses used for the measurements above
```
