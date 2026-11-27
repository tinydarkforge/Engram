# Engram

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-10b981?style=flat-square&labelColor=18181b"></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A520-10b981?style=flat-square&labelColor=18181b">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-native-10b981?style=flat-square&labelColor=18181b">
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-10b981?style=flat-square&labelColor=18181b">
  <a href="https://github.com/tinydarkforge/Engram/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/TinyDarkForge/Engram/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://www.npmjs.com/package/@tinydarkforge/engram"><img alt="npm" src="https://img.shields.io/npm/v/@tinydarkforge/engram?style=flat-square&labelColor=18181b&color=10b981"></a>
</p>

<p align="center">
  <img src="web/engram-dashboard.png" alt="Engram Dashboard" width="720">
</p>

**Engram is local engineering memory for AI coding agents.** It indexes session summaries, stores confidence-ranked assertions in SQLite, detects contradictions, and injects a token-budgeted slice of context through MCP or a CLI.

```mermaid
flowchart LR
    A[Developer session] --> B[Session capture]
    B --> C[Session index]
    B --> D[Assertion ledger]
    C --> E[Keyword / semantic retrieval]
    D --> F[Confidence and tension ranking]
    E --> G[Token-budgeted context]
    F --> G
    G --> H[Claude Code or another MCP client]

    subgraph Local machine
        B
        C
        D
        E
        F
        G
    end
```

No cloud database is required. The default data directory is `~/.engram`.

---

## Quick start

```bash
npm install -g @tinydarkforge/engram
engram setup
claude mcp add engram -s user -- engram mcp
```

Engram is now available as a tool in every Claude Code session. It remembers what you did across every repository, ranks what it knows, and injects a budget-capped slice of context on demand.

---

## How it works

Engram captures engineering work and stores it in two layers:

**Session memory** — Git-hook or manual `engram remember` saves notes, topics, diffs, and test deltas to a per-project index. Every repo on your machine gets its own namespace.

**Assertion ledger** — A SQLite-backed fact store. Every claim records confidence (`0.0–1.0`), status (`tentative → established → fossilized`), quorum count, decay model, lineage, and tension markers.

**Autonomous Intelligence** — Engram runs a background learning loop during consolidation. It automatically detects contradictions (tensions), promotes corroborated facts to established status, and fossilizes outdated knowledge without user intervention.

### Retrieval

Queries traverse four layers, stopping at the earliest one that answers:

| Layer | Size | Latency | Role |
|-------|------|---------|------|
| Bloom filter | 243 B | ~0.1 ms | Instant *"not known"* — zero tokens consumed |
| Session index | ~4 KB | ~10 ms | Compact summaries — answers ~80% of queries |
| Session detail | per-file | ~5 ms | Full content, lazy-loaded on demand |
| Ledger | ~2 KB/fact | 5–15 ms | Ranked facts with confidence, quorum, tension |

Results are packed into a caller-specified token budget using `decay × status × quorum × tension × weight`.

**Semantic search** uses a local ONNX embedding model (`@huggingface/transformers`) that loads lazily on the first semantic query. Text search and keyword recall work without it.

---

## Install

### Global (recommended)

```bash
npm install -g @tinydarkforge/engram
engram setup
```

### From source

```bash
git clone https://github.com/tinydarkforge/Engram.git
cd Engram
npm ci
npm run setup
```

### Connect Claude Code

```bash
# Global install
claude mcp add engram -s user -- engram mcp

# Source install  
claude mcp add engram -s user -- node "$(pwd)/scripts/mcp-server.mjs"
```

---

## Usage

```bash
# Save a session
engram remember "Implemented OAuth callback handling" --topics auth,oauth

# Interactive session capture
engram remember --interactive

# Search across all projects
engram semantic "authentication work"
engram search "oauth"

# One-shot query against the assertion ledger
engram ask "what do we know about authentication"

# Compact low-signal assertions
engram compact

# View status and ledger health
engram status

# Launch the web dashboard
engram start   # → http://127.0.0.1:3000
```

### Dashboard API

The dashboard exposes live metrics endpoints:

| Endpoint | Returns |
|---|---|
| `GET /api/stats` | Session counts, projects, topic count |
| `GET /api/dashboard/tensions` | Unresolved contradictions with claims |
| `GET /api/dashboard/velocity` | Facts/day rate + 30-day sparkline data |
| `GET /api/dashboard/consolidation` | Last consolidation run time and tasks |
| `GET /api/assertions` | Paginated assertion browser |
| `GET /api/assertions/:id` | Full detail with outcomes, lineage, feedback |

### Background consolidation

The dashboard runs periodic consolidation (every 5 min) to close the learning loop:

```
ledger_scan    →  Detect new contradictions (tensions)
ledger_verify  →  Re-verify stale state_bound facts
counterfactual →  Recompute importance weights
post_hoc       →  Score assertion outcomes from sessions
auto_resolve   →  Auto-resolve tensions older than 30 days
```

Refresh the manifest and embeddings manually:
```bash
npm run consolidate:full
```

Run the all-task consolidation cycle:
```bash
node scripts/consolidate.js --all
```

### MCP tools (available in Claude Code, OpenCode, Cursor, Aider, and Windsurf)

Engram exposes tools via MCP for session search, ledger ingestion, context selection, semantic recall, cross-project search, and agent handoff. Run `engram mcp` to start the MCP server, or configure any agent:

```bash
engram setup --agent claude       # Claude Code
engram setup --agent opencode     # OpenCode CLI
engram setup --agent cursor       # Cursor IDE
engram setup --agent aider        # Aider
engram setup --agent windsurf     # Windsurf
```

---

## Core capabilities

- **Cross-project memory** — save and retrieve engineering context across repositories.
- **Session capture** — summarize manual notes or Git changes into a per-project index.
- **Confidence-ranked ledger** — track assertions, quorum, status, lineage, and staleness in SQLite.
- **Contradiction tracking** — identify opposing claims and unresolved tensions.
- **Local semantic search** — uses an ONNX model after the first semantic query; keyword search needs no model download.
- **Token-budgeted retrieval** — pack relevant context into a caller-defined budget.
- **MCP integration** — expose memory tools to MCP-compatible coding clients.
- **Local dashboard** — inspect stats, assertions, tensions, velocity, and consolidation status.

---

## Prerequisites

- **Node.js** `>=20`
- **macOS** or **Linux** (Windows not supported — shell scripts and symlinks)
- **Semantic search** may download an embedding model on first use. Keyword search works without it.

---

## Security

- **No network calls** unless you opt in. The embedding model is downloaded once and cached locally. If you never invoke semantic search, nothing is fetched.
- **No telemetry.** Engram never phones home.
- **Local files only.** Session data lives under `~/.engram/summaries/` and the ledger DB in `~/.engram/.cache/engram.db`.
- Reporting vulnerabilities: see [SECURITY.md](SECURITY.md).

---

## Architecture

Engram uses SQLite as the source of truth. Semantic embeddings are indexed by `sqlite-vec` in the same database, while the normal SQL table stores entity IDs, project metadata, preview text, model and dimensions. Legacy JSON, MessagePack and binary caches are migrated into SQLite when encountered.

```
scripts/     Runtime, CLI, MCP servers, ledger, consolidation
web/         Dashboard UI (Express + static files)
tests/       29 test files (node:test)
schemas/     JSON schemas for sessions and ledger
migrations/  SQLite schema migrations, including the vector index
examples/    Curated session records
```

```mermaid
flowchart TD
    A[engram setup] --> B[Local data in ~/.engram]
    B --> C[engram remember]
    C --> D[Session index]
    C --> E[SQLite assertion ledger]
    F[engram mcp] --> G[MCP-compatible coding agent]
    D --> F
    E --> F
    G --> H[engram start]
    H --> I[Dashboard on localhost:3000]
```

The dashboard and HTTP API listen on `127.0.0.1:3000` by default. The optional streamable HTTP MCP server listens on `127.0.0.1:3001` and supports stdio as well.

---

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center"><a href="https://github.com/tinydarkforge/Engram">GitHub</a> · <a href="mailto:daniel.oceno@gmail.com">Contact</a></p>
