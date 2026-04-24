# Token Savings Benchmarks

## Methodology

### Tokenizer

The benchmark uses a byte-based estimator consistent with GPT-4's cl100k_base tokenizer
(approximately 1 token per 4 bytes of UTF-8). This is deterministic and sufficient for
relative comparisons. If `gpt-tokenizer` is installed, it uses that instead for
cl100k_base-exact counts.

### Corpus

A fixed synthetic corpus in `examples/benchmark-corpus/` — 5 sessions across 2 fictional
projects spanning 4 weeks of realistic engineering work:

| Session | Project | Topics |
|---------|---------|--------|
| proj-a-2025-11-10-auth-refactor | proj-a | auth, jwt, middleware, multi-tenant, security |
| proj-a-2025-11-18-db-migration | proj-a | database, migration, postgresql, audit-log, compliance |
| proj-b-2025-11-22-redis-queue | proj-b | redis, bullmq, queue, email, performance |
| proj-b-2025-12-01-api-rate-limit | proj-b | api, rate-limiting, redis, gateway, security |
| proj-a-2025-12-08-perf-regression | proj-a | performance, postgresql, n-plus-one, regression |

Each session contains a full summary, key decisions, learnings, next steps, and a
file-change manifest.

### Baseline (without Codicil)

What an AI assistant would receive with no memory system:

- All 5 sessions as a raw JSON dump (unfiltered)
- A 150-line simulated git log (6 months of commit history)
- A 200-entry simulated project file tree

### Codicil-assisted

For each query, Codicil selects only sessions whose topics overlap the query's relevant
topics, then renders them as a structured summary. The raw git log and file tree are
omitted — the assistant gets a targeted answer instead of a raw dump.

### Query types

| Query | Type | What it simulates |
|-------|------|-------------------|
| q1-auth-context | resume-work | Developer resuming auth work after a gap |
| q2-db-performance | debugging | Developer debugging a slow database query |
| q3-redis-patterns | new-feature | Developer adding a new Redis-backed feature |

## Results

| Query Type | Baseline Tokens | Codicil Tokens | Savings % |
|------------|----------------|--------------|-----------|
| resume-work | 6,549 | 328 | 95.0% |
| debugging | 6,549 | 621 | 90.5% |
| new-feature | 6,550 | 642 | 90.2% |
| **Average** | **6,549** | **530** | **91.9%** |

## How to reproduce

```bash
npm run benchmark
```

Expected output:

```
Codicil Token Savings Benchmark
Tokenizer : byte estimator (~4 bytes/token)
Sessions  : 5
Queries   : 3
------------------------------------------------------------------
Query Type         Baseline Tokens  Codicil Tokens Savings %
------------------------------------------------------------------
resume-work                   6549           328     95.0%
debugging                     6549           621     90.5%
new-feature                   6550           642     90.2%
------------------------------------------------------------------
AVERAGE                      19648          1591     91.9%
------------------------------------------------------------------

PASS: all queries show >= 50% token savings (average 91.9%)
```

The script exits with code 0 on success and code 1 if any query shows less than 50%
savings (sanity check).

## Caveats

**The corpus is synthetic.** Real-world savings depend on:

- **Project history depth** — more sessions = larger baseline = higher savings. A project
  with 50 sessions produces a much larger raw dump than a project with 5.
- **Query specificity** — broad queries match more sessions and reduce savings. Narrow
  topic queries (resume-work, debugging a specific subsystem) show the highest savings.
- **Session richness** — sessions with detailed decisions and learnings provide more value
  per token in the Codicil path; sparse sessions add less value relative to baseline bulk.
- **Context window budget** — at GPT-4's 128k context window, the absolute savings matter
  more than the percentage when the project is large.

In practice, token savings compound across a working session: each tool call that would
otherwise need to re-explain project history instead receives only the relevant slice.
The per-call savings shown here apply to every context load, not just the first one.
