# Codicil — Premium MCP Tool Plan

> Synthesized from white (architecture) + green (engineering) agents.
> Date: 2026-03-14
> Status: REFINED — v2, incorporating review feedback

---

## Context

Codicil is a solid read-optimized knowledge retrieval system. The gap between what it stores and what AI agents actually need is the entire product opportunity. This plan turns it from a searchable archive into an **active memory layer** — one that AI agents write to as naturally as they read from.

---

## Critical Issues to Fix First

These are broken *today* — before any new features.

| # | Issue | File | Severity |
|---|---|---|---|
| C1 | `.mcp.json` points to `cirrus/DevOps/Codicil` — Claude runs a **different codebase** | `.mcp.json` | Critical |
| C2 | `paths.js` resolves to `TinyDarkForge/Codicil` (wrong dir) — 12 tests permanently broken | `scripts/paths.js` | Critical |
| C3 | `index-git.js` missing — `cross_project_search` throws on every call | `scripts/mcp-tools.js:186` | High |
| C4 | `VectorSearch` re-initialized per `neural_search` call — 1-5s latency every search | `scripts/mcp-tools.js:55` | High |
| C5 | Bloom filter never updated after saves — new sessions invisible to keyword search | `scripts/save-session.js` | Medium |
| C6 | `server.js` calls `codicil.loadIndex()` at require-time — untestable without env var | `scripts/server.js:36` | Medium |
| C7 | MCP server version `1.0.0` mismatches `package.json` `4.0.0` | `scripts/mcp-server.mjs:64` | Low |
| C8 | `cosineSimilarity()` duplicated in `vector-search.js` and `index-git.js` | both files | Low |

---

## The Core Problem

**The MCP server is read-only.**

The `remember` tool is listed in `mcp-server.mjs` comments but never implemented. An AI agent can search memory but cannot write to it. The capture loop is broken at the protocol layer.

**The MCP transport is local-only (stdio).**

The current server uses stdio transport, so it only works when the client spawns a local process. This blocks multi-agent use across machines. A remote transport option is required for networked agents.

---

## PR Roadmap

### PR 1 — Fix the Foundation
**Goal:** All 195 tests green. Claude points at the right codebase.

- [ ] Fix `.mcp.json` to point to `scripts/mcp-server.mjs` in this repo
- [ ] Fix `paths.js` path resolution — scan upward for nearest `index.json` if resolved dir is invalid
- [ ] Refactor `server.js` to not call `loadIndex()` at module load time (factory pattern)
- [ ] Fix `server.test.js` and `integration.test.js` — set `CODICIL_PATH` to test fixture in `before()` hook
- [ ] Fix `npm test` to pass without pre-set env var (`cross-env` or test config)
- [ ] Fix MCP server version to match `package.json`

**Acceptance criteria:**
- `npm test` passes 195/195 with no env setup required
- `node scripts/mcp-server.mjs` starts without error and lists 7 tools via `tools/list`
- `neural_search` cold-start latency (first call after server start) < 5s; warm latency < 200ms
- `.mcp.json` resolves to a file that exists on disk

**Guardrails:**
- No new env var required to run tests
- No behavioral change to existing tool outputs

---

### PR 2a — Write Path: `remember` (Minimal)
**Goal:** Close the write loop with the smallest possible surface area. No enrichments. Fast to ship, safe to roll back.

This PR ships only the core session save. Embedding generation, Bloom filter updates, and concept graph updates are deferred to PR 2b so each can be reverted independently.

**New MCP Tool: `remember`**

```json
{
  "name": "remember",
  "description": "Save a memory or session to Codicil. Call at end of session, after completing a feature, or when recording a decision.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "summary": {
        "type": "string",
        "description": "1-3 sentence summary of what was done or learned.",
        "maxLength": 1000
      },
      "topics": {
        "type": "array",
        "items": { "type": "string" },
        "description": "2-8 topic tags, e.g. ['auth', 'jwt', 'security']",
        "maxItems": 20
      },
      "project": {
        "type": "string",
        "description": "Project name. Required when called via MCP (no cwd context available)."
      },
      "key_decisions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "decision": { "type": "string" },
            "rationale": { "type": "string" }
          }
        }
      },
      "learnings": {
        "type": "array",
        "items": { "type": "string" }
      }
    },
    "required": ["summary", "topics", "project"]
  }
}
```

**Implementation steps:**

- [ ] Add `remember` to `ListToolsRequestSchema` in `mcp-server.mjs`
- [ ] Add `remember` handler in `mcp-tools.js`:
  - Validate inputs — see **Project Naming & Validation Errors** section for exact rules and codes
  - Delegate to `SessionSaver.saveSession()` with `project` as explicit param (bypass `detectProject()`)
  - Invalidate SQLite persistent cache entry for `'index'`
  - Return `{ session_id, project, saved: true }`
  - Emit observability event on success and failure — see **Observability** section
- [ ] Add input validation to `SessionSaver.saveSession()` per the validation contract below
- [ ] Tests: unit test `remember` in `mcp-tools.test.js` with temp fixture; integration test via mock MCP client; test each validation error code

**Critical note:** `SessionSaver` calls `execSync('git config...')` via `detectProject()`. Inside MCP, `process.cwd()` is the server dir, not user's project. `project` must be required — no auto-detection fallback.

**Acceptance criteria:**
- `remember` returns `{ session_id, project, saved: true }` in < 200ms (no embedding, no Bloom, no graph)
- Session file written and readable by `get_session` immediately after
- Invalid inputs return structured error within 50ms — no throws escaping to MCP transport
- Rollback: reverting PR 2a leaves the server fully functional (read-only, same as before)

**Guardrails:**
- `remember` never blocks on model loading
- Validation rejects path traversal before any file IO

---

### PR 2b — Write Path: Enrichments (Embedding + Bloom + Graph)
**Goal:** Make new sessions immediately searchable. Builds on PR 2a. Safe to revert independently.

- [ ] Make `VectorSearch` a **module-level singleton** in `mcp-tools.js` (eliminates 1-5s reload on `neural_search`)
- [ ] After `SessionSaver.saveSession()` succeeds, generate embedding using singleton `VectorSearch`
- [ ] Insert embedding into store; persist to disk async (non-blocking to response)
- [ ] Update Bloom filter incrementally — single `add()` per new topic, no full rebuild
- [ ] Update concept graph edges for new topic pairs in session; re-serialize to `graph.msgpack`
- [ ] Extend `remember` response: `{ session_id, project, saved: true, embedding_generated: boolean }`
- [ ] Tests: verify `neural_search` finds a session saved via `remember` without manual re-index

**Acceptance criteria:**
- `neural_search` warm latency (singleton loaded) < 200ms at ≤ 500 sessions
- New session appears in `neural_search` results within 1s of `remember` returning
- If embedding generation fails, `remember` still returns `saved: true` with `embedding_generated: false` — no cascading failure
- Bloom filter reflects new session topics without requiring `npm run bloom:build`

**Guardrails:**
- In-memory index updated before response; persistence can be async
- Failed embedding persistence never corrupts existing index

---

### PR 3 — Make Search Results Actionable
**Goal:** Search returns IDs — now make them usable.

**Acceptance criteria:**
- `get_session` returns full session data in < 100ms for any valid ID
- `search_sessions` (keyword) returns results in < 50ms with no model loading
- `cross_project_search` never throws — returns `[]` or a structured error object

**Guardrails:**
- No new dependencies required for keyword search
- `cross_project_search` failures are soft and observable (log + structured error)

**New MCP Tool: `get_session`**

- [ ] Accepts `{ project: string, session_id: string }`
- [ ] Delegates to existing `loadSessionDetails()` in `codicil-loader.js` (already implemented, not wired)
- [ ] Returns full session: `{ id, date, summary, topics, key_decisions, learnings, outcomes, code_changes }`

**New MCP Tool: `search_sessions`**

- [ ] Fast synchronous keyword search via `codicil.search()`
- [ ] No model loading — instant results for simple queries
- [ ] Accepts `{ query: string, project?: string, limit?: number }`

**Fix `cross_project_search`:**

- [ ] Option A: Create minimal `scripts/index-git.js` stub that returns `[]` gracefully
- [ ] Option B: Remove the tool entirely if git search is not implemented
- [ ] Either way: no more runtime throw on require

---

### PR 4 — Write-Path Hardening
**Goal:** Concurrent-safe, validated, auto-maintaining writes.

- [ ] Atomic writes for `sessions-index.json`: write to temp file + `fs.renameSync` (POSIX atomic)
- [ ] Atomic write for `index.json` in `updateMainIndex()`
- [ ] Auto-convert to lazy format when project session count exceeds 50
- [ ] After `remember`, auto-rebuild Bloom filter incrementally (not full rebuild)
- [ ] Tests:
  - Concurrent `Promise.all` save test
  - Validation boundary tests (empty summary, oversized input, path traversal in project)

**Acceptance criteria:**
- Two concurrent `remember` calls on the same project produce two valid, distinct sessions — no corruption
- `sessions-index.json` remains valid JSON after a simulated mid-write crash (test by killing process during write and checking file integrity on restart)
- Lazy format conversion triggers automatically at session 51; no manual CLI step needed

**Guardrails:**
- Atomic write is applied to every index update, not just sessions
- Concurrency test runs in CI (not manual)

---

### PR 5 — Developer Experience
**Goal:** Zero-friction setup. No hidden env vars. No missing scripts.

- [ ] `npm run setup` script:
  - Checks `CODICIL_PATH`
  - Creates directory structure if missing
  - Generates minimal `index.json` from template
  - Runs manifest generation and Bloom filter build
  - Idempotent — safe to run multiple times
- [ ] `codicil status` — friendly, non-throwing, actionable:
  - Shows what's missing and exact commands to fix
  - No raw `Error: Codicil index not found at...`
- [ ] Create `scripts/git-hook-capture.sh` with `install` command:
  - Copies post-commit hook template to `.git/hooks/post-commit` of current repo
  - Referenced in QUICKSTART but doesn't exist
- [ ] Update `.mcp.json` template to use relative path or `CODICIL_PATH` env interpolation
- [ ] Tests: setup script idempotency test

**Acceptance criteria:**
- `npm run setup` on a fresh clone with no env vars produces a working MCP server in < 5 minutes
- `codicil status` output includes exact command to fix each missing component — no "see docs" deflections
- `git-hook-capture.sh install` works on macOS and Linux; script is idempotent

**Guardrails:**
- `npm run setup` never deletes user data
- `codicil status` exits 0 and never throws

---

### PR 6 — Remote MCP Transport (Streamable HTTP)
**Goal:** Allow agents on other machines to connect to Codicil over the network.

**Recommendation:** Implement **Streamable HTTP** transport. The legacy SSE-only transport is deprecated and should not be used for new work. Plain HTTP without streaming is not sufficient for MCP.

**Implementation steps:**

- [ ] Add `scripts/mcp-server-http.mjs` using `StreamableHTTPServerTransport`
- [ ] Expose `/mcp` endpoint and SSE stream endpoint per SDK example
- [ ] Add CLI flag or env config for `MCP_BIND_ADDR` and `MCP_PORT`
- [ ] Add minimal auth hook placeholder (API key header or reverse proxy config)
- [ ] Update README/QUICKSTART with remote connection instructions

**Acceptance criteria:**
- A client can connect using Streamable HTTP from another machine and list tools
- Unauthenticated request to `/mcp` returns `401` — no tool list exposed
- Invalid API key returns `403`
- Multiple concurrent clients can connect without cross-session contamination
- Server runs behind a reverse proxy with TLS termination

**Guardrails:**
- Rate limiting applies to the `/mcp` request endpoint only — the streaming response must not be buffered or throttled by the server or proxy
- All connections are cleaned up on close/error to avoid leaks

> **Note:** Client config examples and operational runbook belong in `docs/remote-setup.md` when PR 6 ships. Claude Desktop uses `{ "url": "https://codicil.yourdomain.com/mcp" }` — no custom transport field.

---

## Security Baseline (Recommended)

These are defaults for a premium, agent-agnostic deployment. IP allowlist is optional and should be configurable, not enforced by default.

- **TLS everywhere:** terminate TLS at the reverse proxy or on the Node server
- **Auth:** API key header (`MCP_API_KEY` env var) or upstream auth (SSO/OAuth) at the proxy
- **Rate limiting:** 60 req/min per API key — enforce at nginx (`limit_req`) or Node sliding window; prevents agent runaway loops hammering `neural_search`/`remember`
- **Optional IP allowlist:** allow on private ranges or specific CIDRs; keep disabled by default
- **LAN-only mode:** bind to a private interface and block public ingress at the firewall
- **Audit logs:** log `tool` calls with `project`, `session_id`, and `duration_ms` to a separate `codicil-audit.log` file (not stderr) — no session payloads logged

---

## Project Naming Convention & Validation Errors

All validation failures must return a structured error object — never an unhandled throw.

### Project Name Rules

- **Allowed characters:** `[a-zA-Z0-9._-]` — alphanumeric, dot, underscore, hyphen
- **Max length:** 100 characters
- **Min length:** 1 character
- **Case:** preserved as-given; stored and matched case-sensitively
- **Normalization:** strip leading/trailing whitespace before validation
- **Reserved names:** `__global__`, `__test__`, `__system__` — reserved for internal use

### Validation Error Contract

All `remember` and write-path tools return errors in this shape:

```json
{
  "error": true,
  "code": "CODICIL_ERR_<CODE>",
  "message": "<human readable>",
  "field": "<which input field>",
  "value": "<the invalid value, truncated to 100 chars>"
}
```

| Code | Trigger | Message |
|---|---|---|
| `CODICIL_ERR_PROJECT_REQUIRED` | `project` missing or empty string | `"project is required when calling remember via MCP"` |
| `CODICIL_ERR_PROJECT_INVALID_CHARS` | `project` contains disallowed characters | `"project name may only contain letters, numbers, dots, underscores, and hyphens"` |
| `CODICIL_ERR_PROJECT_TOO_LONG` | `project` > 100 chars | `"project name must be 100 characters or fewer"` |
| `CODICIL_ERR_PROJECT_RESERVED` | `project` is a reserved name | `"project name '__global__' is reserved"` |
| `CODICIL_ERR_SUMMARY_REQUIRED` | `summary` missing or empty | `"summary is required"` |
| `CODICIL_ERR_SUMMARY_TOO_LONG` | `summary` > 1000 chars | `"summary must be 1000 characters or fewer (got N)"` |
| `CODICIL_ERR_TOPICS_REQUIRED` | `topics` missing or empty array | `"topics must be a non-empty array"` |
| `CODICIL_ERR_TOPICS_TOO_MANY` | `topics` length > 20 | `"topics must contain 20 or fewer items"` |
| `CODICIL_ERR_TOPIC_TOO_LONG` | any single topic > 50 chars | `"each topic must be 50 characters or fewer (got 'X...' at index N)"` |
| `CODICIL_ERR_SESSION_NOT_FOUND` | `get_session` called with unknown ID | `"session 'X' not found in project 'Y'"` |
| `CODICIL_ERR_INDEX_NOT_FOUND` | Codicil index missing at startup | `"Codicil index not found — run 'npm run setup' to initialize"` |
| `CODICIL_ERR_WRITE_FAILED` | Disk write failure | `"failed to save session: <os error message>"` |

---

## Backward Compatibility & Migration

### Existing Clients

- All 7 existing MCP tools (`neural_search`, `get_bundle`, `list_projects`, `recent_sessions`, `get_topics`, `query_concept`, `cross_project_search`) must continue to work with **no input or output shape changes** through all PRs
- New tools are additive only — no existing tool is removed or renamed before a deprecation notice
- Response shapes of existing tools are frozen; new fields may be added but existing fields cannot be removed or renamed

### Existing Index Files

PRs 1–5 must not require manual migration of existing data. Specifically:

| File | Change | Migration |
|---|---|---|
| `index.json` | No schema change | None |
| `sessions-index.json` | No schema change | None |
| `embeddings.json` | PR 2b reads existing format; no write format change | None — existing embeddings remain valid |
| `graph.msgpack` | PR 2b appends new edges; existing edges untouched | None |
| `.mcp.json` | Corrected path | Developer updates manually (documented in PR 1 release notes) |

### SQLite Embeddings Migration (A3 — Post-PR-4)

When moving embeddings from `embeddings.json` to SQLite:

1. Run migration script (`npm run migrate:embeddings`) — reads `embeddings.json`, inserts all rows into `embeddings` table
2. Validation step: compare row count to entry count in `embeddings.json` — abort if mismatch
3. Keep `embeddings.json` as read-only backup for 30 days; do not delete automatically
4. Migration is idempotent — safe to re-run (upsert by `session_id`)
5. Old server versions reading `embeddings.json` continue to work until explicitly upgraded

### Session Linking (A5 — Post-PR-5)

`parent_id` and `thread_id` are optional fields on existing session schema. Existing sessions have neither field — this is valid. No backfill required. Clients that read session data must treat absence of these fields as `null`.

---

## Observability

All write-path operations and search calls must emit structured log events. Use a thin wrapper — no external logging dependency required in PRs 1–5.

### Log Format

```json
{
  "ts": "<ISO 8601>",
  "event": "<event_name>",
  "level": "info|warn|error",
  "data": { "<event-specific fields>" }
}
```

Written to `stderr` so MCP stdio transport is not contaminated. Can be redirected independently: `node mcp-server.mjs 2>> codicil.log`.

### Events to Emit

| Event | Level | When | Key Fields |
|---|---|---|---|
| `remember.success` | info | Session saved successfully | `session_id`, `project`, `topics`, `duration_ms`, `embedding_generated` |
| `remember.validation_error` | warn | Input fails validation | `code`, `field`, `project` (if present) |
| `remember.write_failed` | error | Disk write throws | `project`, `error_message`, `duration_ms` |
| `remember.embedding_failed` | warn | Embedding generation fails (PR 2b) | `session_id`, `project`, `error_message` |
| `neural_search.success` | info | Search completes | `query_len`, `result_count`, `duration_ms`, `mode` |
| `neural_search.no_results` | info | Search returns empty | `query_len`, `bloom_filter_hit`, `duration_ms` |
| `session_save.concurrent_detected` | warn | Two saves overlap on same project | `project`, `session_id_1`, `session_id_2` |

### Counters (for `codicil status` and future dashboards)

Persist lightweight counters to `.cache/metrics.json`:

```json
{
  "remember_calls_total": 0,
  "remember_failures_total": 0,
  "neural_search_calls_total": 0,
  "sessions_total": 0,
  "last_remember_at": null,
  "last_search_at": null
}
```

Updated on every relevant event. Read by `codicil status` to show usage summary. No external metrics dependency in PRs 1–5.

---

## Architecture Risks & Mitigations (Review)

This section captures corner cases and failure modes that must be addressed as the plan is implemented.

### Concurrency & Durability

- **Async embedding persistence vs. search visibility:** If embeddings are persisted asynchronously, a crash can make new sessions invisible to `neural_search`. Mitigation: update an in-memory index before returning, then persist; optionally add a durable queue.
- **Multi-process index writes:** Atomic rename only protects a single writer. Mitigation: move index data to SQLite earlier, enforce a single writer, or implement file locking with conflict detection.
- **Session ID collisions:** Timestamp IDs can collide under concurrency or across machines. Mitigation: use ULID/UUID for IDs.
- **Metrics file corruption:** Concurrent updates to `.cache/metrics.json` can corrupt the file. Mitigation: atomic writes plus a mutex, or move metrics into SQLite.
- **Stale locks after crashes:** Lock files can block writes forever if a process dies mid-write. Mitigation: lock TTL + stale lock recovery, and lock creation in the same directory as the target.
- **Atomic writes across filesystems:** `rename` is only atomic within a filesystem. Mitigation: write temp files next to target file, then `fsync` temp before rename for critical indexes.

### Filesystem & Naming

- **Case-insensitive filesystems:** Project names that differ by case collide on macOS. Mitigation: normalize a storage slug (e.g., lower-case) and store the display name separately.
- **Path traversal edge cases:** Validation must reject `..` and path separators before any file IO.
- **Project slug collisions:** Case-insensitive filesystems can map distinct names to the same slug. Mitigation: detect collisions and return a structured error if a different display name maps to an existing slug.

### Search & Indexing

- **Bloom filter staleness:** Updates/deletes cannot be removed, increasing false positives. Mitigation: periodic rebuilds or replace with FTS; consider dropping Bloom filter at <1k sessions.
- **Linear scan performance:** `neural_search` targets may fail as sessions grow. Mitigation: cache embeddings in memory and add ANN (e.g., HNSW or sqlite-vec) past a threshold.
- **Embedding version drift:** Store `embedding_model` and `embedding_version` per session to support future upgrades.
- **Multi-process in-memory divergence:** Singleton ANN index per process can diverge in multi-instance deployments. Mitigation: shared index storage, single-writer mode, or explicit documentation that multi-instance without shared index is eventually inconsistent.

### Network Transport (PR 6)

- **Streaming resource leaks:** Streamable HTTP sessions must close cleanly on disconnect. Mitigation: onclose cleanup, idle timeouts, heartbeat pings, and explicit transport disposal.
- **Rate limiting vs. streams:** Apply rate limits only to request endpoints; do not limit the streaming endpoint. Disable proxy buffering for the stream.

### Operational Safety

- **Crash recovery:** Add a startup repair routine to detect missing embeddings or corrupted indexes and rebuild if needed.
- **Index rebuild tool:** Provide an explicit `rebuild_index` tool or CLI command for maintenance.

---

## New MCP Tools: Full Roadmap (Post-PR-5)

| Tool | Purpose | Effort | Priority |
|---|---|---|---|
| `remember` | Write path — save session/learning | M | P0 (PR 2) |
| `get_session` | Drill into search result by ID | S | P0 (PR 3) |
| `search_sessions` | Fast keyword search, no model | S | P0 (PR 3) |
| `timeline` | Query by date range / project / topic | M | P1 |
| `add_learning` | Append decision/learning to existing session | S | P1 |
| `get_project_context` | One-shot project onboarding payload | M | P1 |
| `find_related` | Related sessions by ID (`findSimilarTo` exists, not wired) | S | P1 |
| `update_session` | Edit session summary or topics | S | P2 |
| `generate_summary` | Standup/weekly report from session data | M | P2 |
| `search_git` | Dedicated semantic search over commits | M | P2 |
| `list_sessions` | Project-scoped, filterable, paginated | S | P2 |
| `find_duplicates` | Knowledge base cleanup | S | P2 |
| `suggest_context` | **Killer feature** — proactive context push | L | P3 |
| `rebuild_index` | Trigger full re-index after batch saves | M | P3 |
| `generate_embeddings` | Trigger embedding generation via MCP | M | P3 |

---

## Architecture Changes Required

### A1: VectorSearch Singleton (PR 2)
Move `VectorSearch` instantiation to module level in `mcp-tools.js`. Eliminates 1-5s model reload on every `neural_search` call.

### A2: Auto-Index on Write (PR 2)
When `remember` saves a session:
1. Generate embedding inline (model already loaded as singleton)
2. Insert into embeddings store
3. Add terms to Bloom filter incrementally
4. Update concept graph edges for new topic pairs

New sessions immediately searchable. No stale index.

### A3: Move Embeddings to SQLite (Post-PR-4)

**Current:** Single JSON blob (`embeddings.json`) — full file loaded into memory per search. O(n) linear scan.

**Target:** SQLite table in existing `codicil.db`:
```sql
CREATE TABLE embeddings (
  session_id TEXT PRIMARY KEY,
  embedding BLOB,
  text_preview TEXT,
  project TEXT,
  created_at INTEGER
);
CREATE INDEX idx_emb_project ON embeddings(project);
```

Path to ANN: at 5K+ sessions, add HNSW index via `sqlite-vss`. No new database dependency.

### A4: Unified Search Layer (Post-PR-4)

**Current:** Three separate search paths with different result shapes:
- `search()` — keyword
- `semanticSearch()` — vector
- `cross_project_search()` — git

**Target:** Single `search(query, { mode: 'keyword' | 'semantic' | 'hybrid', project?, limit? })`.
Hybrid mode runs keyword + semantic in parallel, merges via Reciprocal Rank Fusion (RRF).

### A5: Session Linking (Post-PR-5)

Add optional `parent_id` and `thread_id` to sessions. When saving a follow-up session, link to the previous one. Enables:
- "Show me the full thread of auth work"
- "What was the outcome of this decision?"
- Temporal dependency queries

### A6: Consolidate `cosineSimilarity` (PR 1 or PR 2)

Extract to `scripts/utils/math.js`. Remove duplication from `vector-search.js` and `index-git.js`.

---

## The Killer Feature: `suggest_context`

**What it does:**

Before the developer types anything in a new conversation, the AI calls:
```
suggest_context({ file_paths: ["auth/middleware.ts", "api/routes.ts"], project: "myapp" })
```

Codicil responds:
> "You worked on auth middleware 3 days ago. Key decision: switched from session tokens to JWT. Warning: known race condition in rate limiter under concurrent requests (session `ct-2026-03-11-ratelimit`). Related: OAuth PKCE work from 2 weeks ago may be affected."

**Why it's the killer feature:**
- Transforms Codicil from "search tool I sometimes use" to "persistent memory that makes every conversation smarter"
- Creates lock-in: after 6 months of project memory surfacing automatically, you never go back to stateless conversations
- No user action required — the AI agent calls it as a startup routine

**Implementation requirements:**
- File-path-to-session mapping index (new)
- Semantic search over file paths + task descriptions
- Cross-reference with recent sessions and open decisions
- Returns: `{ relevant_sessions, relevant_decisions, warnings, suggested_context_block }`

---

## MCP Prompts (Missing Entirely)

The MCP spec supports `prompts` — pre-built prompt templates. Codicil registers none. Add:

| Prompt | Description |
|---|---|
| `summarize_today` | "Summarize everything I worked on today across all projects" |
| `project_onboarding` | "Give me full context for starting work on {project}" |
| `weekly_report` | "Generate a weekly report of work done in {project}" |
| `decision_log` | "Show all architectural decisions made in {project} this month" |

---

## Integration Opportunities (Future)

| Integration | Value | Effort |
|---|---|---|
| Git deeper (diff analysis, branch context) | High | Medium |
| Filesystem watcher (auto-ingest `CLAUDE.md`, docs changes) | High | Medium |
| GitHub MCP (index PRs, issues, reviews) | Medium | Medium |
| Claude agent memory bridge (`~/.claude/agent-memory/`) | High | Large |
| VSCode extension (sidebar + "Remember this" context menu) | Medium | Large |

---

## Combined MCP Config (Ship With Both Repos)

**Local (stdio — default):**
```json
{
  "mcpServers": {
    "codicil": {
      "command": "node",
      "args": ["${CODICIL_PATH}/scripts/mcp-server.mjs"]
    },
    "agentbridge": {
      "command": "node",
      "args": ["${AGENTBRIDGE_PATH}/dist/mcp/index.js"],
      "env": { "AGENTBRIDGE_TOKEN": "your-token" }
    }
  }
}
```

**Remote (Streamable HTTP — after PR 6):**
```json
{
  "mcpServers": {
    "codicil": {
      "url": "https://codicil.yourdomain.com/mcp"
    }
  }
}
```

---

## Success Metrics

| Metric | Current | Target |
|---|---|---|
| Tests passing | 183/195 | 195/195 |
| MCP tools (read) | 7 | 7 |
| MCP tools (write) | 0 | 3+ |
| MCP prompts | 0 | 4 |
| `neural_search` latency | 1-5s (model reload) | <200ms (singleton) |
| New session searchable in | manual CLI rebuild | <1s (auto-index) |
| Setup time (fresh clone) | ~20 min | <5 min (`npm run setup`) |

---

## Decisions Made (Closed)

1. **`project` is required in `remember`** — no auto-detection fallback. MCP has no cwd context; git-based detection would silently resolve to wrong project. Explicit is safer.

---

## Open Questions for Review

1. Should `index-git.js` be built out or removed? (It's referenced but missing)
3. SQLite for embeddings: migrate existing `embeddings.json` data, or start fresh and re-generate?
4. Session linking (`parent_id`): opt-in per save, or auto-detect continuation based on time + project?
5. `suggest_context`: push via MCP sampling (server-initiated) or pull (client calls on startup)?
6. Should the Bloom filter rebuild be synchronous (blocks `remember` response) or queued async?
7. Should `remember.embedding_failed` be a silent warn or surface to the MCP caller as a partial-success response?
8. Metrics file (`.cache/metrics.json`): atomic write or acceptable to lose a counter increment on crash?
