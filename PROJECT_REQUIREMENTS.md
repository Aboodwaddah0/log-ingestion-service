# Log Ingestion and Query Service

## Final Project Requirements & Technical Specification

---

# 1. Project Overview

The goal of this project is to build a high-performance **Log Ingestion and Query Service**.

The system should ingest large volumes of structured logs, store them efficiently in PostgreSQL, and provide APIs for searching, filtering, and aggregating those logs.

The system is conceptually similar to a simplified version of platforms such as:

* Datadog
* Grafana Loki

Applications will send logs to the service, and the service will make those logs searchable and analyzable.

### Expected Development Timeline

1–2 weeks.

---

# 2. Main Responsibilities

The system has three primary responsibilities:

## 2.1 Ingestion

Provide an API that:

* Accepts batches of structured logs.
* Validates every log entry independently.
* Accepts valid entries even when other entries in the same batch are invalid.
* Rejects invalid entries with their array index and rejection reason.
* Stores accepted logs efficiently.
* Supports high-throughput ingestion.

## 2.2 Querying

Provide APIs that allow users to:

* Filter logs by service.
* Filter logs by level.
* Filter by timestamp range.
* Filter by arbitrary attributes.
* Search message content.
* Paginate through large datasets using cursors.
* Aggregate logs into time buckets.
* Group aggregations by supported dimensions.

## 2.3 Retention

Logs must not be stored indefinitely.

The system must provide a configurable retention strategy that removes expired logs while minimizing:

* Long-running locks.
* Table bloat.
* Impact on ingestion performance.
* Impact on query performance.

---

# 3. Log Data Model

Every log entry contains:

| Field        | Required | Description                         |
| ------------ | -------- | ----------------------------------- |
| `timestamp`  | Yes      | ISO 8601 timestamp                  |
| `level`      | Yes      | `debug`, `info`, `warn`, or `error` |
| `service`    | Yes      | Service name                        |
| `message`    | Yes      | Log message                         |
| `attributes` | No       | Flat key/value metadata             |

### Example

```json
{
  "timestamp": "2026-07-20T14:32:01.123Z",
  "level": "error",
  "service": "checkout",
  "message": "payment declined",
  "attributes": {
    "user_id": "42",
    "region": "eu-west",
    "retries": 3
  }
}
```

---

# 4. Attribute Storage Strategy

Attributes are one of the most important design decisions in this project.

The `attributes` field contains arbitrary key/value pairs.

Allowed values:

* strings
* numbers
* booleans

Not allowed:

* nested objects
* arrays

Example:

```json
{
  "user_id": "42",
  "region": "eu-west",
  "retries": 3,
  "is_mobile": true
}
```

The implementation must document:

* How attributes are stored.
* Why this storage strategy was selected.
* How attribute queries are performed.
* Which indexes are used.
* The performance trade-offs of the chosen approach.

---

# 5. Technology Constraints

The project should use:

* Node.js
* TypeScript
* Express
* PostgreSQL
* Docker / Docker Compose

PostgreSQL must remain the **source of truth for both reads and writes**.

Additional infrastructure is allowed, but PostgreSQL must remain authoritative.

## Database Access

Do not use an ORM.

Use PostgreSQL directly through a PostgreSQL client such as `pg`.

Database access should be separated from HTTP handlers.

---

# 6. Resource Constraints

The grading environment has strict resource limits.

## Application

```text
CPU: 0.5 CPU
RAM: 256 MB
```

## PostgreSQL

```text
CPU: 1 CPU
RAM: 1 GB
```

The system must be designed and benchmarked under these constraints.

---

# 7. Docker Requirements

The complete system must start with:

```bash
docker compose up
```

No manual database setup should be required.

The startup process must automatically:

1. Start PostgreSQL.
2. Establish the database connection.
3. Apply database migrations.
4. Start the application.
5. Mark the application as healthy.

The service must listen on:

```text
8080
```

inside the application container.

Docker Compose must expose:

```text
localhost:8080
```

---

# 8. Health Check

## GET /health

Returns HTTP `200` once the service is ready to accept traffic.

The service must NOT report itself as healthy until:

1. The database connection has been established.
2. Database migrations have been applied.
3. The application is ready to accept logs.

The load generator will poll this endpoint before starting the test.

---

# 9. Required API Contract

The required API contract must be implemented exactly.

Additional endpoints are allowed, but the following endpoints must exist exactly as specified:

```text
GET  /health
POST /logs
GET  /logs
GET  /logs/aggregate
```

The automated load generator will communicate with these endpoints.

Changing the required paths or response structures can cause the submission to fail.

---

# 10. POST /logs — Log Ingestion

The endpoint always accepts a batch.

A batch containing one log entry is valid.

## Request

```json
{
  "logs": [
    {
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42",
        "region": "eu-west",
        "retries": 3
      }
    }
  ]
}
```

---

# 11. Ingestion Validation

Every log entry must be validated independently.

## timestamp

Required.

Must:

* Be a valid ISO 8601 timestamp.
* Not be more than five minutes in the future.

## level

Required.

Allowed values:

```text
debug
info
warn
error
```

## service

Required.

Must be a non-empty string.

## message

Required.

Must be a non-empty string.

## attributes

Optional.

Must be a flat object.

Allowed values:

* strings
* numbers
* booleans

Not allowed:

* nested objects
* arrays

---

# 12. Batch Behavior

An invalid log entry must NOT cause the entire batch to fail.

The service must:

1. Accept valid entries.
2. Reject invalid entries.
3. Return the index of every rejected entry.
4. Return a rejection reason for every rejected entry.

Example:

```json
{
  "accepted": 9,
  "rejected": [
    {
      "index": 3,
      "reason": "invalid level: 'critical'"
    }
  ]
}
```

## Response Status

Return:

### HTTP 200

When at least one log entry is accepted.

### HTTP 400

When:

* All entries are rejected.
* Request JSON is malformed.
* The request does not match the expected top-level structure.

---

# 13. GET /logs — Query Logs

All query parameters are optional and may be freely combined.

## Supported Parameters

| Parameter    | Description                        | Example                      |
| ------------ | ---------------------------------- | ---------------------------- |
| `service`    | Exact service match                | `service=checkout`           |
| `level`      | Exact level match                  | `level=error`                |
| `since`      | Inclusive start timestamp          | `since=2026-07-20T14:00:00Z` |
| `until`      | Exclusive end timestamp            | `until=2026-07-20T15:00:00Z` |
| `attr.<key>` | Attribute equality                 | `attr.user_id=42`            |
| `q`          | Case-insensitive message substring | `q=declined`                 |
| `limit`      | Maximum results                    | `limit=500`                  |
| `cursor`     | Pagination cursor                  | `cursor=...`                 |

---

# 14. Query Rules

## Limit

Default:

```text
100
```

Maximum:

```text
1000
```

## Sorting

Results must be sorted by timestamp descending.

When multiple logs have the same timestamp, ordering must remain deterministic.

The recommended ordering is:

```sql
ORDER BY timestamp DESC, id DESC
```

---

# 15. Cursor-Based Pagination

Pagination must use an opaque cursor.

The cursor is returned by the previous request and passed back unchanged by the client.

Example:

```text
GET /logs?limit=100
```

Response:

```json
{
  "logs": [],
  "next_cursor": "eyJ0cyI6IjIwMjYt..."
}
```

The next request:

```text
GET /logs?limit=100&cursor=eyJ0cyI6IjIwMjYt...
```

The cursor format is implementation-defined.

The load generator treats it as an opaque value.

The cursor must allow efficient pagination without relying on large `OFFSET` values.

The recommended cursor fields are:

```text
timestamp
id
```

The query should use the same ordering:

```text
timestamp DESC, id DESC
```

---

# 16. GET /logs Response

Example:

```json
{
  "logs": [
    {
      "id": "any-unique-id",
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42"
      }
    }
  ],
  "next_cursor": "eyJpZCI6..."
}
```

When there are no additional results:

```json
{
  "logs": [],
  "next_cursor": null
}
```

---

# 17. Invalid Query Parameters

Invalid query parameters must return HTTP `400`.

Response format:

```json
{
  "error": "<description>"
}
```

Invalid examples include:

* Invalid timestamps.
* `until` earlier than `since`.
* Unsupported log levels.
* Non-numeric limits.
* Limits outside the supported range.
* Invalid cursors.
* Malformed cursors.

---

# 18. GET /logs/aggregate — Aggregation

This endpoint returns time-bucketed log counts.

It supports the same filters as `/logs`:

* `service`
* `level`
* `attr.<key>`
* `q`

It also requires aggregation parameters.

---

# 19. Aggregation Parameters

| Parameter  | Required | Description               |
| ---------- | -------- | ------------------------- |
| `since`    | Yes      | Inclusive start           |
| `until`    | Yes      | Exclusive end             |
| `bucket`   | Yes      | Bucket size               |
| `group_by` | No       | Group by service or level |

Supported bucket sizes:

```text
1m
5m
1h
1d
```

Supported grouping:

```text
service
level
```

---

# 20. Aggregation Example

Request:

```text
GET /logs/aggregate?since=2026-07-20T14:00:00Z&until=2026-07-20T15:00:00Z&bucket=1m&group_by=service
```

Response:

```json
{
  "buckets": [
    {
      "start": "2026-07-20T14:00:00Z",
      "group": "checkout",
      "count": 118
    },
    {
      "start": "2026-07-20T14:00:00Z",
      "group": "auth",
      "count": 42
    },
    {
      "start": "2026-07-20T14:01:00Z",
      "group": "checkout",
      "count": 97
    }
  ]
}
```

Results must be ordered by bucket start time ascending.

Empty buckets may be omitted.

When `group_by` is not provided:

```json
{
  "group": null
}
```

Invalid aggregation parameters must return HTTP `400` using the same error format as `/logs`.

---

# 21. Performance Requirements

Performance is a core requirement.

A solution that is functionally correct but cannot meet the performance requirements is considered incomplete.

The system must:

* Sustain at least **15,000 logs/second**.
* Avoid dropped requests during sustained ingestion.
* Avoid application crashes.
* Maintain query performance while ingestion is active.
* Handle approximately **1,000,000 stored logs**.
* Assume approximately one month of data.
* Make newly ingested logs queryable within **20 seconds**.
* Support at least **1 aggregation request per second** during ingestion.

---

# 22. Performance Target

Baseline:

```text
15,000 logs/sec
```

Additional credit may be given for higher sustained throughput:

```text
20,000 logs/sec
25,000 logs/sec
Higher
```

Performance must be measured rather than assumed.

---

# 23. Performance Testing

The project must include load testing.

The README must document:

* Test environment.
* Dataset size.
* Batch size.
* Ingestion rate.
* Query rate.
* Query latency percentiles.
* CPU usage.
* Memory usage.
* Bottlenecks discovered.
* Optimizations applied.

Important metrics include:

```text
Throughput
p50 latency
p95 latency
p99 latency
CPU
Memory
Database performance
Error rate
```

---

# 24. Query Performance

The primary aggregation query must complete in:

```text
< 1 second at p95
```

This must remain true while ingestion is active.

Important queries should be analyzed using:

```sql
EXPLAIN
```

or:

```sql
EXPLAIN ANALYZE
```

The README must explain the important query plans and index usage.

---

# 25. Database Design

PostgreSQL is the source of truth.

The database design must consider:

* High ingestion throughput.
* Efficient time-range queries.
* Service filtering.
* Level filtering.
* Attribute filtering.
* Message searching.
* Aggregation.
* Cursor pagination.
* Retention.

Indexes must be aligned with actual query patterns.

The README must explain:

* Schema design.
* Index design.
* Why each important index exists.
* Query patterns supported by each index.
* Any performance trade-offs.

---

# 26. Ingestion Performance

The ingestion path should avoid:

* One SQL query per log.
* One INSERT per log.
* Unnecessary serialization/deserialization.
* Unnecessary copying of large arrays.
* Excessive object allocation.
* ORM overhead.

Preferred approaches include:

* PostgreSQL `COPY`.
* Batch processing.
* Streaming where appropriate.
* Efficient validation.
* Efficient database writes.
* Reusable database connections.

The ingestion path is the most performance-sensitive part of the application.

---

# 27. Query Architecture

The application should separate:

```text
HTTP Request
     ↓
Controller
     ↓
Service
     ↓
Query Builder / Repository
     ↓
PostgreSQL
```

HTTP handlers should not contain complex database logic.

Database queries should be isolated inside repositories or dedicated database modules.

Dynamic SQL must always be safely parameterized.

SQL injection is disqualifying.

---

# 28. Cursor Query Design

The recommended ordering is:

```sql
ORDER BY timestamp DESC, id DESC
```

The cursor should contain the values required to continue from the previous position.

Conceptually:

```text
(timestamp, id)
```

The next page should only return records after the cursor according to the same ordering.

The implementation must avoid large `OFFSET` values because they become increasingly expensive as the dataset grows.

---

# 29. Retention Strategy

Logs must eventually expire.

The retention implementation must:

* Be configurable.
* Delete expired logs.
* Avoid long-running transactions.
* Avoid major ingestion disruption.
* Minimize table bloat.
* Minimize locking impact.

The README must document:

* Retention configuration.
* How expiration is detected.
* How deletion is performed.
* How often cleanup runs.
* Performance considerations.

---

# 30. Reliability Requirements

The system must correctly handle:

* Invalid logs.
* Malformed JSON.
* Invalid query parameters.
* Invalid timestamps.
* Invalid cursors.
* Empty result ranges.
* Empty aggregation ranges.
* Unsupported levels.
* Invalid limits.
* Database errors.
* Concurrent ingestion and querying.

The application must fail gracefully.

It must not crash because of malformed client input.

---

# 31. Security Requirements

All database queries must use parameterized queries.

Never construct SQL by directly concatenating untrusted user input.

This includes dynamic filters such as:

```text
service
level
attributes
q
```

Dynamic query construction must use safe parameter handling.

SQL injection is considered a critical failure.

---

# 32. Optional Features

Optional features are allowed, but they must never break the required API contract.

Extras are:

```text
Additive, never subtractive.
```

An optional feature must never:

* Remove a required endpoint.
* Rename a required endpoint.
* Change required response shapes.
* Change required response types.
* Introduce required parameters or headers.
* Cause a valid core request to fail.

If an optional feature cannot satisfy these rules, it must be disabled by default.

---

# 33. Zero-Configuration Requirement

Running:

```bash
docker compose up
```

with no:

* `.env` file
* arguments
* manual setup

must produce the plain core service.

The following endpoints must work:

```text
GET  /health
POST /logs
GET  /logs
GET  /logs/aggregate
```

All four endpoints must accept unauthenticated requests by default.

No rate limit or quota should interfere with the load generator.

---

# 34. Optional Authentication

Authentication is optional.

If implemented:

```text
AUTH_ENABLED=false
```

must be the default.

When authentication is disabled, the service must behave exactly like the unauthenticated core service.

Optional configuration:

```text
AUTH_ENABLED=false
LOADGEN_API_KEY=
```

When:

```text
AUTH_ENABLED=true
```

and:

```text
LOADGEN_API_KEY=<key>
```

the service must seed the key automatically during startup or migration.

No manual SQL or admin request may be required.

The seeded key must have full ingest and query permissions.

---

# 35. Authentication Transport

Primary authentication method:

```http
Authorization: Bearer <key>
```

Optional:

```http
X-API-Key: <key>
```

Credentials must never be passed through:

* Query strings.
* Request bodies.

---

# 36. Authentication Status Codes

| Condition                    | Status |
| ---------------------------- | ------ |
| Missing/malformed credential | 401    |
| Insufficient permission      | 403    |
| Rate limit exceeded          | 429    |

Example:

```json
{
  "error": "<description>"
}
```

Authentication failures must never return HTTP `500`.

Authentication failures must never return HTTP `200` with an empty result set.

---

# 37. Health Authentication Exception

`GET /health` must always remain unauthenticated.

This remains true even when:

```text
AUTH_ENABLED=true
```

The load generator uses `/health` before it has credentials.

---

# 38. Load Generator Compatibility

The load generator is not customized for individual projects.

Therefore:

* Required endpoints must remain unchanged.
* Required request formats must remain unchanged.
* Required response formats must remain unchanged.
* Optional features must not interfere with normal requests.

When authentication is disabled, an unrecognized Authorization header must simply be ignored.

---

# 39. CI Requirements

The CI pipeline must perform meaningful validation.

At minimum:

* Install dependencies.
* Build the project.
* Run tests.
* Run required-contract smoke tests.

If authentication is implemented, CI must test:

### Configuration 1

```text
AUTH_ENABLED=false
```

All four required endpoints must work without credentials.

### Configuration 2

```text
AUTH_ENABLED=true
LOADGEN_API_KEY=<key>
```

The endpoints must:

* Work with the seeded bearer token.
* Return `401` without valid credentials.

---

# 40. README Requirements

The repository README must document:

## Setup

* Installation.
* Docker Compose startup.
* Configuration.

## API

* `/health`
* `/logs`
* `/logs/aggregate`
* Request examples.
* Response examples.
* Validation behavior.
* Error behavior.

## Database

* Schema.
* Indexes.
* Attribute storage strategy.

## Retention

* Retention configuration.
* Cleanup strategy.

## Performance

* Test environment.
* Dataset size.
* Batch size.
* Ingestion throughput.
* Query rate.
* Query latency.
* Resource usage.
* Bottlenecks.
* Optimizations.

## Limitations

Document known limitations honestly.

## Optional Features

For every optional feature document:

* Feature name.
* Whether enabled by default.
* Environment variables.
* How to enable it.
* How to disable it.
* Confirmation that the default `docker compose up` remains compatible with the core contract.

---

# 41. Evaluation Criteria

The project will be evaluated in the following areas.

## Architecture

Evaluate:

* Schema design.
* Attribute storage.
* Data flow.
* Project structure.
* Separation of responsibilities.

## Performance

Evaluate:

* Ingestion throughput.
* Query latency.
* Index effectiveness.
* Aggregation performance.
* Concurrent ingestion and querying.

## Retention

Evaluate:

* Expired-data deletion.
* Locks.
* Table bloat.
* Ingestion impact.

## Reliability

Evaluate:

* Validation.
* Error handling.
* Malformed input.
* Invalid cursors.
* Empty ranges.
* Edge cases.

## Code Quality

Evaluate:

* TypeScript quality.
* Strong typing.
* Readability.
* Maintainability.
* Clear abstractions.

## Security

Evaluate:

* Parameterized queries.
* Safe dynamic SQL.
* SQL injection protection.

## Separation of Concerns

Database and query-building logic must remain separated from HTTP handlers.

## Infrastructure

Evaluate:

* Docker Compose.
* Automatic migrations.
* First-run experience.
* Startup reliability.

## CI

Evaluate:

* Build.
* Tests.
* Contract validation.
* Meaningful automation.

## Documentation

Evaluate:

* Setup instructions.
* API documentation.
* Schema reasoning.
* Index reasoning.
* Attribute strategy.
* Retention strategy.
* Performance evidence.
* Known limitations.

## Creativity and Polish

Useful improvements beyond the minimum requirements may receive additional credit.

---

# 42. Stretch Goals

Stretch goals are optional.

The priority is always:

```text
Reliable + Correct + Performant Core
```

before implementing extras.

Possible stretch goals:

* Dashboard.
* Operational metrics.
* Alerting.
* Webhook notifications.
* Live-tail endpoint.
* Pre-aggregated rollup tables.
* Custom query language.
* Multi-tenancy.
* Data compression.
* Rate limiting.
* Dead-letter handling.
* Backpressure.
* Additional observability.

Every stretch feature must remain compliant with the optional-feature rules.

---

# 43. Deliverables

The final submission must include:

## GitHub Repository

The repository should have:

* Clean code.
* Readable commit history.
* Incremental progress.
* Meaningful commits.

## Docker Compose

The complete solution must start with:

```bash
docker compose up
```

## CI

A working CI pipeline that performs:

* Build.
* Tests.
* Contract validation.
* Other meaningful checks.

## README

Must contain:

* Setup.
* Usage.
* API documentation.
* Schema design.
* Index design.
* Attribute strategy.
* Retention strategy.
* Load-test methodology.
* Performance results.
* Known limitations.
* Optional features and configuration.

---

# 44. Demo Requirements

The project must be ready for a live technical walkthrough.

Be prepared to:

1. Explain the architecture.
2. Explain the major technical decisions.
3. Justify the database schema.
4. Justify the indexes.
5. Run `EXPLAIN` or `EXPLAIN ANALYZE`.
6. Walk through the ingestion flow.
7. Walk through the query flow.
8. Explain cursor pagination.
9. Explain the attribute storage strategy.
10. Explain the retention strategy.
11. Explain performance bottlenecks.
12. Explain optimizations.
13. Debug an issue live.
14. Modify or extend a feature live.

The developer must understand the submitted code.

AI-generated code is allowed, but the submitted system must be fully understandable and explainable by the developer.

---

# 45. Required Video

Each intern must submit an approximately **5-minute video**.

The video must include:

## Architecture Explanation

Explain:

* Overall architecture.
* Main components.
* Data flow.
* Database design.
* Important technical decisions.

## Live Demo

Demonstrate:

* Starting the application.
* Ingesting logs.
* Querying logs.
* Filtering.
* Pagination.
* Aggregation.
* Any important implemented features.

The purpose of the video is to demonstrate depth of understanding, not simply the final result.

---

# 46. Definition of Done

The project is considered complete only when all of the following are satisfied:

* [ ] `docker compose up` starts the complete system.
* [ ] PostgreSQL migrations run automatically.
* [ ] `/health` becomes healthy only after the application is ready.
* [ ] `POST /logs` supports batches.
* [ ] Per-entry validation works.
* [ ] Invalid entries do not reject valid entries.
* [ ] `GET /logs` supports all required filters.
* [ ] Filters can be freely combined.
* [ ] Cursor-based pagination works.
* [ ] Pagination ordering is deterministic.
* [ ] `GET /logs/aggregate` works.
* [ ] All required bucket sizes work.
* [ ] Grouping by service works.
* [ ] Grouping by level works.
* [ ] Invalid parameters return the required `400` format.
* [ ] Retention is implemented and documented.
* [ ] Queries are parameterized and protected from SQL injection.
* [ ] The system handles approximately 1,000,000 logs.
* [ ] Ingestion reaches at least 15,000 logs/sec.
* [ ] Aggregation reaches p95 < 1 second.
* [ ] Queries remain usable during ingestion.
* [ ] Newly ingested logs become queryable within 20 seconds.
* [ ] CI passes.
* [ ] README is complete.
* [ ] Performance has been measured.
* [ ] Important queries have been analyzed with `EXPLAIN ANALYZE`.
* [ ] The architecture can be explained during the demo.
* [ ] The 5-minute demo video is prepared.

---

# 47. Development Priority

When deciding what to implement next, follow this priority:

## Priority 1 — Correctness

Implement the required API contract exactly.

## Priority 2 — Reliability

Handle:

* Validation.
* Errors.
* Edge cases.
* Database failures.
* Malformed requests.

## Priority 3 — Performance

Optimize:

* Ingestion.
* PostgreSQL writes.
* Indexes.
* Query execution.
* Cursor pagination.
* Aggregation.

## Priority 4 — Retention

Implement efficient expiration and deletion.

## Priority 5 — Testing and CI

Automate validation of the core contract.

## Priority 6 — Documentation

Document architecture and measured performance.

## Priority 7 — Stretch Goals

Only implement optional features after the core system is reliable and performant.

---

# 48. Engineering Principles

Throughout development:

1. Prefer measurable improvements over assumptions.
2. Do not optimize without benchmarking when possible.
3. Keep the architecture simple.
4. Avoid unnecessary abstractions.
5. Keep HTTP, business logic, and persistence separated.
6. Use PostgreSQL efficiently.
7. Protect all dynamic SQL from injection.
8. Avoid unnecessary memory usage.
9. Consider the 256 MB application memory limit.
10. Consider the 1 GB PostgreSQL memory limit.
11. Preserve the required API contract.
12. Do not introduce optional features that interfere with the load generator.
13. Document important architectural decisions.
14. Measure performance before and after major optimizations.
15. The final implementation must be understandable by the developer.

---

# 49. Primary Project Goal

The final system should provide a production-oriented log service capable of:

* High-throughput ingestion.
* Reliable batch validation.
* Efficient PostgreSQL storage.
* Fast log querying.
* Flexible filtering.
* Attribute-based filtering.
* Cursor-based pagination.
* Time-bucketed aggregation.
* Efficient retention.
* Reliable operation under load.
* Approximately 1 million stored logs.
* At least 15,000 logs/sec sustained ingestion.
* p95 aggregation latency below 1 second.
* Clean architecture.
* Strong documentation.
* Automated testing and CI.

The most important principle is:

> **Build a correct, reliable, measurable, and performant core before adding optional features.**
