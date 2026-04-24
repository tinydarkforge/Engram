# Codicil

Local-first memory and assertion ledger for AI coding agents. MCP-native.

![Codicil demo](docs/assets/demo.gif)
<!-- demo.gif coming soon -->

Codicil keeps a persistent, queryable record of your engineering sessions across every repo. It feeds that memory to AI assistants through MCP — so you stop re-explaining the same context every session. The assertion ledger layer goes further: it tracks facts with confidence, detects contradictions, and builds trust through corroboration across sessions.

---

## Why Not mem0 / Letta / Zep?

| Feature | **Codicil** | mem0 | Letta / Zep |
|---|---|---|---|
| Local-first (no cloud required) | Yes | No — cloud hosted | No — cloud hosted |
| Assertion ledger | Yes — confidence, lineage, quorum | No | No |
| Contradiction detection | Yes — automatic negation-based | No | No |
| MCP-native (Claude Code) | Yes — stdio + HTTP transport | No | No |
| Session memory across coding sessions | Yes — git-hook capture, semantic search | Partial | Partial |
| Token-efficient retrieval | Yes — bloom filter + lazy index (94-98% reduction) | No | No |
| Runs fully offline | Yes | No | No |

---

## Quick Start

```bash
git clone https://github.com/Pamperito74/Codicil.git
cd Codicil
npm install && npm run setup
```

Save a session:

```bash
./scripts/remember "Implemented OAuth callback handling" --topics auth,oauth
```

Query memory:

```bash
node scripts/codicil-loader.js semantic "authentication work"
```

Full setup guide: [QUICKSTART.md](QUICKSTART.md)

---

## Connect Claude Code (MCP)

```bash
claude mcp add codicil -s user -- node /path/to/Codicil/scripts/mcp-server.mjs
```

That's it. Codicil tools are now available in every Claude Code session: `neural_search`, `remember`, `ledger_ingest`, `ledger_query`, `ledger_select_context`, and more.

Remote HTTP transport with API-key auth: [docs/remote-setup.md](docs/remote-setup.md)

---

## Assertion Ledger

![Ledger](docs/assets/ledger-screenshot.png)
<!-- ledger-screenshot.png coming soon -->

The ledger is a SQLite-backed fact store. Every assertion carries:

- **Confidence** `[0.0–1.0]` — starts uncertain, grows through corroboration
- **Quorum count** — how many independent sources have confirmed it
- **Status** — `tentative` → `established` → `fossilized`
- **Staleness model** — `flat`, `exponential`, `episodic`, `state_bound`, or `contextual` decay
- **Lineage** — which sessions contributed to this fact
- **Contradiction detection** — automatic negation-based tension seeding; unresolved tensions surface as alerts

Facts are ranked by `decay × status × quorum × tension × weight` and packed into a token budget for context injection.

Full reference: [docs/ASSERTION-API-REFERENCE.md](docs/ASSERTION-API-REFERENCE.md) | [docs/LEDGER-GUIDE.md](docs/LEDGER-GUIDE.md)

---

## How Retrieval Works

Queries go through four layers, stopping as early as possible:

| Layer | Size | Latency | Role |
|---|---|---|---|
| Bloom filter | 243 bytes | 0.1 ms | Instant "not known" — zero tokens consumed |
| Index | 4 KB | ~10 ms | Compact summaries — answers 80% of queries |
| Session details | Per-file | ~5 ms | On-demand, loaded only when needed |
| Assertion ledger | ~2 KB/fact | 5–15 ms | Ranked facts with confidence and lineage |

Average query: ~1,000 tokens vs ~50,000 tokens without Codicil.

Benchmarks: [docs/BENCHMARKS.md](docs/BENCHMARKS.md)

---

## Dashboard and API

```bash
node scripts/server.js
```

- Dashboard: `http://127.0.0.1:3000/`
- API: `http://127.0.0.1:3000/api/stats`
- Health: `http://127.0.0.1:3000/health`

---

## Repo Layout

```
scripts/     runtime, CLI, servers, MCP tools, ledger
tests/       194 tests across 16 files (node:test)
web/         dashboard UI
docs/        setup and operational docs
summaries/   session indexes and records
```

---

## Related Docs

- [QUICKSTART.md](QUICKSTART.md)
- [HOW-IT-WORKS.md](HOW-IT-WORKS.md)
- [CHEATSHEET.md](CHEATSHEET.md)
- [docs/LEDGER-GUIDE.md](docs/LEDGER-GUIDE.md)
- [docs/ASSERTION-API-REFERENCE.md](docs/ASSERTION-API-REFERENCE.md)
- [docs/remote-setup.md](docs/remote-setup.md)
- [docs/BENCHMARKS.md](docs/BENCHMARKS.md)
