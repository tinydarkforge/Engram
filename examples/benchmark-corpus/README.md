# Benchmark Corpus

Fixed synthetic corpus for `npm run benchmark`. Do not modify — changes affect reproducibility.

## Sessions (`sessions/`)

Five richly-structured sessions across two fictional projects:

| File | Project | Date | Topics |
|------|---------|------|--------|
| `proj-a-2025-11-10-auth-refactor.json` | proj-a | 2025-11-10 | auth, jwt, middleware, multi-tenant, security |
| `proj-a-2025-11-18-db-migration.json` | proj-a | 2025-11-18 | database, migration, postgresql, audit-log, compliance |
| `proj-b-2025-11-22-redis-queue.json` | proj-b | 2025-11-22 | redis, bullmq, queue, email, performance |
| `proj-b-2025-12-01-api-rate-limit.json` | proj-b | 2025-12-01 | api, rate-limiting, redis, gateway, security |
| `proj-a-2025-12-08-perf-regression.json` | proj-a | 2025-12-08 | performance, postgresql, n-plus-one, regression, audit-log |

Each session has: `summary`, `topics`, `key_decisions`, `outcomes`, `learnings`, `code_changes`.
`_index_size_bytes` and `_full_size_bytes` reflect the actual JSON sizes.

## Queries (`queries/`)

Three queries covering the main retrieval scenarios:

| File | Type | Description |
|------|------|-------------|
| `q1-auth-context.json` | resume-work | Resume auth work — only proj-a auth sessions are relevant |
| `q2-db-performance.json` | debugging | Debug slow query — proj-a DB/perf sessions relevant |
| `q3-redis-patterns.json` | new-feature | Add Redis feature — proj-b Redis sessions relevant |

## Baseline construction

The benchmark script simulates what an AI assistant would receive *without* Codicil:
- All 5 sessions serialized as raw JSON (no filtering)
- A synthetic git log (150 one-line entries representing 6 months of project history)
- A synthetic file tree (200 entries across both projects)

## Codicil-assisted construction

For each query the benchmark selects only sessions whose `topics` overlap the query's
`relevant_topics`, then serializes only those sessions. The synthetic git log and file
tree are omitted — Codicil provides a structured answer, not a raw dump.
