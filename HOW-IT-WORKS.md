# How Codicil Works - Technical Deep Dive

## Overview

Codicil is a persistent memory system that stores, indexes, and retrieves project knowledge across AI sessions. It uses a three-layer architecture optimized for minimal token usage.

---

## Three-Layer Architecture

```
Query → Bloom Filter → Index → Full Details
         ↓              ↓         ↓
         "NO!" (0 tok)  Summary   Complete
         ↓              (1K tok)  (1.1K tok)
         STOP           ↓
                       80% stop here
```

### Layer 1: Bloom Filter (0.1ms)

A probabilistic data structure that instantly answers "Is this topic known?"

- **Size:** ~243 bytes for hundreds of topics
- **False positives:** <1% (tunable)
- **False negatives:** 0% (guaranteed)
- **Implementation:** `scripts/bloom-filter.js`
- **Storage:** `.neural/bloom.json`

When the answer is "NO", zero tokens are consumed. No index loaded, no files read.

### Layer 2: Index (4KB)

A compact JSON file (`index.json`) with abbreviated keys:

```json
{
  "v": "4.0.0",
  "u": "2025-12-20",
  "m": { "ts": 42 },
  "p": {
    "ProjectName": { "sc": 10, "u": "2025-12-20", "d": "Description" }
  },
  "t": {
    "auth": { "sc": 8, "p": ["ProjectName"] }
  }
}
```

Key abbreviations: `v`=version, `u`=updated, `m`=metadata, `ts`=totalSessions, `p`=projects, `t`=topics, `sc`=sessionCount, `d`=description.

80% of queries are answered from the index alone.

### Layer 3: Full Details (on-demand)

Session files are loaded only when the index can't answer the query:

```
summaries/projects/<ProjectName>/
├── sessions-index.json    # Lightweight: id, date, summary, topics
└── sessions/
    └── <session-id>.json  # Full: notes, code, git stats, files
```

Lazy loading (`scripts/lazy-loader.js`) keeps session indexes small by storing detailed metadata in separate files.

### Layer 4: Assertion Ledger (Phase 10)

A fact database that builds confidence through corroboration and detects contradictions. Sessions feed structured facts into the ledger, where they accumulate evidence across sessions.

```
Session Notes (100-500 tokens)
  ↓
  Extract → Facts (terse, high-value)
  ↓
Assertion Ledger (SQLite, .cache/codicil.db)
  • plane: authority (user:daniel, project:Codicil, session:xyz)
  • claim: fact text (e.g., "React batch updates improve performance")
  • confidence: [0.0-1.0] (starts at 0.5, grows with corroboration)
  • quorum_count: number of independent sources
  • status: tentative → established → fossilized
  • staleness_model: flat|exponential|episodic|state_bound|contextual
  • lineage: source_spans tracking which sessions contributed
  ↓
Ranking (decay × status × quorum × tension × weight)
  ↓
Context Selection (budget-aware, ~400-500 facts per 1M tokens)
```

**Key improvements:**
- **Trustworthiness signal:** Facts gain weight through multiple sources (quorum), not just frequency
- **Contradiction detection:** Automatic negation-based tension seeding; visible contradictions alert users
- **Authority separation:** Facts from different sources don't mix; "personal opinion" ≠ "proven system fact"
- **Staleness management:** Different decay curves for different fact types (architecture facts decay differently than build status)
- **Bulk transformation:** Transform script reconciles assertions at scale with user confirmation gate

**Storage:** SQLite (~2KB per assertion), lazy-loaded on first query. Query latency ~5-15ms for ranking 100 facts.

See [PHASE-10-ASSERTION-LEDGER.md](./PHASE-10-ASSERTION-LEDGER.md) and [Ledger Guide](./docs/LEDGER-GUIDE.md) for details.

---

## Data Flow

### Saving a Session

```
User runs `remember "summary" --topics x,y`
  → scripts/remember (smart wrapper)
    → scripts/save-session.js
      1. Detect project from git remote / cwd
      2. Generate session ID: <prefix>-<date>-<slug>
      3. Write session file to summaries/projects/<proj>/sessions/
      4. Update sessions-index.json
      5. Update index.json (project + topic counters)
      6. Emit codicil.session.saved to AgentBridge (if configured)
```

### Querying

```
User runs `codicil search "auth"`
  → scripts/codicil-loader.js
    1. Bloom filter check (0.1ms) → skip if not found
    2. Load index.json (4KB)
    3. Search topics, projects, sessions by keyword
    4. Return matches with metadata
    5. Emit codicil.query.result to AgentBridge (if configured)
```

### Semantic Search

```
User runs `codicil semantic "authentication work"`
  → scripts/codicil-loader.js → scripts/vector-search.js
    1. Load/build embeddings (.neural/embeddings.msgpack)
    2. Encode query with all-MiniLM-L6-v2 (384 dimensions)
    3. Cosine similarity against all session embeddings
    4. Apply time decay (recent sessions rank higher)
    5. Return top-K results with scores
```

---

## Caching Strategy

Three tiers of caching, each with different characteristics:

| Tier | Storage | Size | TTL | Speed |
|------|---------|------|-----|-------|
| **Hot** | In-memory Map | 10 items | Session | <1ms |
| **Warm** | In-memory Map | 100 items | Session | <1ms |
| **Persistent** | SQLite | Unlimited | 60 min | ~5ms |

The persistent cache (`scripts/persistent-cache.js`) uses SQLite via `better-sqlite3`:

- Survives process restarts
- Version-aware (auto-clears on version bump)
- LRU eviction when size exceeds max entries
- Tracks hit/miss ratios for observability

---

## File Formats

### MessagePack (.msgpack)

Binary format used for large data structures. 44% smaller than JSON.

Used for:
- `.neural/graph.msgpack` - Concept relationship graph
- `.neural/embeddings.msgpack` - Vector embeddings
- `.neural/bundles/<project>.msgpack` - Pre-compiled project context
- `.neural/git-index.msgpack` - Git commit search index

### JSON (.json)

Human-readable format used for primary data:
- `index.json` - Main index
- `sessions-index.json` - Per-project session list
- Individual session files

All JSON reads use `safe-json.js` which wraps `JSON.parse` in try/catch with schema validation to prevent crashes from corrupt files.

---

## Key Components

### scripts/codicil-loader.js
Main entry point. The `Codicil` class provides:
- `loadIndex()` - Load the main index
- `search(query)` - Keyword search
- `semanticSearch(query)` - Vector similarity search
- `detectProject()` - Auto-detect project from git/cwd
- `listSessions(project)` - Get sessions for a project

### scripts/save-session.js
Handles session creation with:
- Project detection from git remote
- Session ID generation
- Index updates (atomic write via temp file + rename)
- AgentBridge event emission

### scripts/mcp-tools.js
Extracted tool implementations for the MCP server:
- `neuralSearch()` - Semantic search with enrichment
- `getBundle()` - Pre-compiled project context
- `listProjects()` - All projects with stats
- `queryConcept()` - Knowledge graph lookup
- `crossProjectSearch()` - Multi-repo git search

### scripts/server.js
Express HTTP server powering the web dashboard:
- 7 REST API endpoints matching the frontend contract
- Path sanitization on all route params
- Query length limits on search endpoints
- AgentBridge event consumer lifecycle management

### scripts/agentbridge-client.js
Thin HTTP client for AgentBridge communication:
- Opt-in via `AGENTBRIDGE_URL` env var
- Graceful degradation (no-op stub when unavailable)
- 3-second timeout, fire-and-forget semantics
- Registers 3 event schemas on connect

### scripts/event-consumer.js
Polls AgentBridge for incoming events:
- Listens for `codicil.query.requested` events
- Runs searches and emits `codicil.query.result` responses
- Deduplicates events by ID
- Tracks processing stats

---

## AgentBridge Integration

Codicil integrates with AgentBridge for inter-agent communication:

```
Agent A                  AgentBridge              Codicil
  |                         |                       |
  |-- query.requested ----->|                       |
  |                         |----> poll (5s) ------>|
  |                         |                  search()
  |                         |<---- query.result ----|
  |<--- query.result -------|                       |
```

**Event types:**
- `codicil.session.saved` - Emitted when a session is saved
- `codicil.query.requested` - Received from other agents wanting to search
- `codicil.query.result` - Emitted with search results

**Configuration:** Set `AGENTBRIDGE_URL=http://localhost:7890` to enable. When unset, all AgentBridge calls are no-ops with zero overhead.

---

## Testing

194 tests across 16 test files using Node.js built-in `node:test`:

```bash
npm test                    # Run all tests
node --test tests/foo.js    # Run specific test file
```

Tests use:
- Real `http.createServer` mocks (no external test deps)
- Temp directories with synthetic data
- Module cache clearing for isolation

---

## Performance Characteristics

| Operation | Time | Tokens |
|-----------|------|--------|
| Bloom filter lookup | 0.1ms | 0 |
| Index load | ~10ms | ~1,000 |
| Session load | ~5ms | ~100-500 |
| Keyword search | ~20ms | ~1,000 |
| Semantic search | ~200ms | ~1,000 |
| Full context load | ~50ms | ~2,000 |
