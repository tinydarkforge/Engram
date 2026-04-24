<!-- markdownlint-disable MD033 MD041 -->

```text
                           █████ █████ ████  █████ █████ █████ █
    ╔═══════════╗          █     █   █ █   █   █   █       █   █
    ║   ╓─╥─╖   ║          █     █   █ █   █   █   █       █   █
    ║  ╔═════╗  ║          █     █   █ █   █   █   █       █   █
    ║  ║● · ●║  ║          █████ █████ ████  █████ █████ █████ █████
    ║  ║  ▬  ║  ║
    ║  ╚══╤══╝  ║          ━━━━━━━━━━ MEMORY LEDGER ━━━━━━━━━━━━━
    ║  ███████  ║          Sessions · Facts · Confidence · MCP
    ║   ▀▀ ▀▀   ║          · Local-first — one ledger, one
    ║ CodiCil_  ║            confidence model, one context
    ╚═══════════╝            budget. MIT · No account · No tel.
```

<p align="center">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-00cc66.svg?style=flat-square&labelColor=0a0a0a"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-00cc66.svg?style=flat-square&labelColor=0a0a0a">
  <img alt="mcp" src="https://img.shields.io/badge/MCP-native-00cc66.svg?style=flat-square&labelColor=0a0a0a">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-00cc66.svg?style=flat-square&labelColor=0a0a0a">
  <a href="SECURITY.md"><img alt="security" src="https://img.shields.io/badge/security-policy-00cc66.svg?style=flat-square&labelColor=0a0a0a"></a>
  <a href="https://github.com/tinydarkforge/Codicil/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/TinyDarkForge/Codicil/actions/workflows/ci.yml/badge.svg?branch=main"></a>
</p>

> **Codicil** is a local-first memory and assertion ledger for AI coding agents. It persists session notes across every repo, ranks facts by confidence and corroboration, surfaces contradictions, and feeds the whole thing to Claude Code over MCP. No account. No telemetry. Local files only.

> **Status:** Pre-1.0 (`v4.0.0`). Not yet on npm — install from source. MCP server is stable; assertion ledger is active development.

---

## ░▒▓█ TL;DR

```bash
git clone https://github.com/tinydarkforge/Codicil.git
cd Codicil && npm install && npm run setup
claude mcp add codicil -s user -- node "$(pwd)/scripts/mcp-server.mjs"
```

Codicil is now a tool in every Claude Code session. It remembers what you did, ranks what it knows, and injects a budget-capped slice of context on demand — stopping at the earliest retrieval layer that answers the query.

---

## ░▒▓█ What it does today

Codicil captures engineering work and exposes it as structured memory:

- **Session memory** — Git-hook capture or manual `remember`. Sessions carry notes, topics, diffs, test deltas. Per-project, per-repo, across every codebase on your machine.
- **Assertion ledger** — SQLite-backed fact store. Every claim has confidence `[0.0–1.0]`, status (`tentative → established → fossilized`), quorum count, lineage, and decay. Contradictions surface as unresolved tensions.
- **Token-efficient retrieval** — Four-layer stack (bloom filter → index → session detail → ledger). Stops at the earliest layer that answers the query. 80% of queries answered from a 4 KB index. Context is always token-budgeted by the caller.
- **MCP-native** — stdio and Streamable HTTP transport. Tools: `neural_search`, `remember`, `ledger_ingest`, `ledger_query`, `ledger_select_context`, `cross_project_search`, `get_bundle`, `recent_sessions`.
- **Dashboard + HTTP API** — Local web UI at `:3000` for browsing sessions, inspecting ledger state, reviewing tensions.

Codicil does not call any remote model by default. Semantic search runs a local ONNX embedding model (`@huggingface/transformers`) that loads lazily on the first semantic query. If you never invoke semantic search, no model is ever downloaded.

---

## ░▒▓█ How retrieval works

Queries traverse four layers, stopping as early as possible:

| Layer              | Size      | Latency | Role                                                      |
|--------------------|-----------|---------|-----------------------------------------------------------|
| **Bloom filter**   | 243 bytes | 0.1 ms  | Instant *"not known"* — zero tokens consumed              |
| **Index**          | 4 KB      | ~10 ms  | Compact summaries — answers 80% of queries                |
| **Session detail** | per-file  | ~5 ms   | Lazy-loaded on demand                                     |
| **Ledger**         | ~2 KB/fact| 5–15 ms | Ranked facts with confidence, quorum, tension, lineage    |

Facts are ranked by `decay × status × quorum × tension × weight` and packed into a caller-specified token budget. Architecture deep dive: [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md).

---

## ░▒▓█ Assertion ledger

The ledger is where session notes become structured, queryable knowledge. Every assertion records:

- **Plane** — authority scope (`user:alice`, `project:codicil`, `session:xyz`)
- **Claim** — terse fact text
- **Confidence** — `[0.0–1.0]`, starts uncertain, grows with corroboration
- **Quorum** — independent sources confirming the fact
- **Status** — `tentative` → `established` → `fossilized`
- **Decay model** — `flat`, `exponential`, `episodic`, `state_bound`, `contextual`
- **Lineage** — which sessions contributed
- **Tension** — automatic negation-based contradiction detection

Tensions surface as alerts; unresolved ones downweight their claims in context selection. Full reference: [`docs/ASSERTION-API-REFERENCE.md`](docs/ASSERTION-API-REFERENCE.md) · [`docs/LEDGER-GUIDE.md`](docs/LEDGER-GUIDE.md).

---

## ░▒▓█ Positioning

Codicil is **not** a hosted memory SaaS, a vector-DB-as-a-service, or a RAG framework. It is **a local ledger and MCP server** for engineering context.

| Alternative      | When to pick it instead of Codicil                              |
|------------------|-----------------------------------------------------------------|
| **mem0**         | You want hosted memory, team sync, managed upgrades.            |
| **Letta / Zep**  | You want agent-framework primitives and hosted chat state.      |
| **Plain RAG**    | You only need retrieval over static docs, no fact lifecycle.    |
| **Raw SQLite**   | You want a schema you control and don't need MCP or ranking.    |

**Codicil's niche:** local-first, confidence-weighted, contradiction-aware, token-budgeted context for AI coding agents. Runs fully offline. If you want dashboards-as-a-service or team-wide sync, pick mem0 or Zep.

| Feature                              | **Codicil** | mem0        | Letta / Zep |
|--------------------------------------|:-----------:|:-----------:|:-----------:|
| Local-first (no cloud required)      | Yes         | No          | No          |
| Assertion ledger (confidence/quorum) | Yes         | No          | No          |
| Contradiction detection              | Yes         | No          | No          |
| MCP-native (Claude Code)             | Yes         | No          | No          |
| Git-hook session capture             | Yes         | Partial     | Partial     |
| Token-efficient retrieval            | Yes (budgeted)| No        | No          |
| Runs fully offline                   | Yes         | No          | No          |

---

## ░▒▓█ Prerequisites

- **Node.js** `>=20`
- **macOS** or **Linux**. Windows not supported (shell scripts + symlinks).
- **First semantic query:** downloads a ~100 MB local embedding model (`@huggingface/transformers`). Text search (`npm run search`) and keyword recall work without it.

---

## ░▒▓█ Install

### From source (currently the only install path)

```bash
git clone https://github.com/tinydarkforge/Codicil.git
cd Codicil
npm install
npm run setup
node scripts/codicil-loader.js status
```

npm publish is pending (tracked in issue #28). Once published:

```bash
npm install -g codicil   # not yet available
```

### Connect Claude Code

```bash
claude mcp add codicil -s user -- node /absolute/path/to/Codicil/scripts/mcp-server.mjs
```

Remote HTTP transport with API-key auth: [`docs/remote-setup.md`](docs/remote-setup.md).

---

## ░▒▓█ Usage

```bash
# Save a session
./scripts/remember "Implemented OAuth callback handling" --topics auth,oauth

# Interactive save
./scripts/remember --interactive

# Git-hook capture (auto-save on commit)
./scripts/git-hook-capture.sh install

# Semantic search
node scripts/codicil-loader.js semantic "authentication work"

# Keyword search
node scripts/codicil-loader.js search "oauth"

# Status
node scripts/codicil-loader.js status

# Launch dashboard
npm start   # http://127.0.0.1:3000/

# Ledger CLI
npm run ledger:stats
npm run ledger:migrate
```

Full CLI reference: [`CHEATSHEET.md`](docs/CHEATSHEET.md) · deep dive: [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md).

---

## ░▒▓█ Dashboard + API

```bash
node scripts/server.js
```

- Dashboard: `http://127.0.0.1:3000/`
- API:       `http://127.0.0.1:3000/api/stats`
- Health:    `http://127.0.0.1:3000/health`

The dashboard is read-only by default. Ledger mutations require the MCP or CLI path.

---

## ░▒▓█ Security

- **No network calls** unless you opt in. The embedding model downloads lazily on the first semantic query and is then cached locally — if you never invoke semantic search, nothing is fetched.
- **No telemetry.** Codicil does not phone home. Ever.
- **Local files only.** All session data lives under the repo in `summaries/` and the ledger DB in `.cache/codicil.db`.
- **API-key auth** for remote HTTP MCP transport — see [`docs/remote-setup.md`](docs/remote-setup.md).
- **Vuln disclosure:** [`SECURITY.md`](SECURITY.md).

---

## ░▒▓█ Repo layout

```text
scripts/     runtime, CLI, servers, MCP tools, ledger
tests/       29 test files (node:test)
web/         dashboard UI (static)
docs/        setup, reference, operational docs
schemas/     JSON schemas for sessions + ledger
migrations/  SQLite schema migrations
examples/    curated session records
summaries/   per-project session indexes + records
```

---

## ░▒▓█ Platform support

| Platform | Status                                       |
|----------|----------------------------------------------|
| macOS    | Supported                                    |
| Linux    | Supported                                    |
| Windows  | Not supported (shell scripts, POSIX symlinks)|

---

## ░▒▓█ Related docs

- [`QUICKSTART.md`](QUICKSTART.md) — end-to-end first session
- [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md) — architecture deep dive
- [`CHEATSHEET.md`](docs/CHEATSHEET.md) — CLI + MCP reference
- [`docs/LEDGER-GUIDE.md`](docs/LEDGER-GUIDE.md) — assertion ledger operator guide
- [`docs/ASSERTION-API-REFERENCE.md`](docs/ASSERTION-API-REFERENCE.md) — ledger API
- [`docs/remote-setup.md`](docs/remote-setup.md) — remote MCP transport
- [`docs/WHAT-IS-CODICIL.md`](docs/WHAT-IS-CODICIL.md) — plain-language overview
- [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) · [`SECURITY.md`](SECURITY.md)

---

<p align="center"><em>CodiCil — because every agent deserves a ledger, not a goldfish bowl.</em></p>
