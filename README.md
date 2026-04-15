# Memex

Persistent project memory for AI coding workflows.

Memex stores short session records about what was built, indexes them by project and topic, and exposes that memory through:
- a local CLI
- a local HTTP server and web UI
- MCP servers for assistant integration

The practical goal is simple: stop re-explaining the same project context to your tools every session.

## What It Is

Memex is a local knowledge store for engineering work. A session usually contains:
- a short summary
- topics/tags
- project name
- timestamp
- optional git change metadata
- optional detailed notes

From there, Memex provides several ways to retrieve that memory:
- quick index lookups
- keyword search
- semantic search with embeddings
- project/session browsing in a dashboard
- MCP tools for assistants like Claude Code

This repo is best understood as a local memory service plus integration layer, not just a CLI script collection.

## What It Is For

Use Memex if you want to:
- keep a running memory of engineering work across repositories
- give AI tools a lightweight summary of past sessions and conventions
- save sessions manually or from git-hook-driven workflows
- query memory from CLI, HTTP, or MCP
- optionally expose the service to your LAN or remote clients

It is most useful for solo or small-team workflows where a local, file-backed memory store is good enough.

## Current Capabilities

- Session capture with project detection and topic indexing
- Concurrency-safe writes for session/index updates
- Project and topic indexes stored on disk
- Keyword search across projects and stored session summaries
- Semantic search using `@huggingface/transformers`
- Time decay in semantic ranking
- Duplicate detection helpers in vector search
- Local web dashboard for projects, sessions, search, and graph views
- MCP server over stdio
- Streamable HTTP MCP server with API-key auth
- AgentBridge integration for event-based coordination

## What It Is Not

- Not a hosted SaaS
- Not a multi-user sync platform yet
- Not a full database-backed collaboration product
- Not guaranteed to be the best fit if you need strict auth, audit trails, or enterprise sharing

Open issues still reflect that:
- team sharing is still open
- auto-summarization is still open
- better topic extraction is still open

## Quick Start

```bash
git clone https://github.com/Pamperito74/Memex.git
cd Memex
npm install
npm run setup
node scripts/memex-loader.js status
```

Save a session:

```bash
./scripts/remember "Implemented OAuth callback handling" --topics auth,oauth
```

Query memory:

```bash
node scripts/memex-loader.js quick "commit format"
node scripts/memex-loader.js search auth
node scripts/memex-loader.js semantic "authentication work"
```

Full quickstart: [QUICKSTART.md](QUICKSTART.md)

## Run The HTTP Server

Local-only by default:

```bash
node scripts/server.js
```

Custom port:

```bash
PORT=8080 node scripts/server.js
```

Expose on your local network:

```bash
HOST=0.0.0.0 node scripts/server.js
```

Defaults and behavior:
- default host is `127.0.0.1`
- default port is `3000`
- `HOST=0.0.0.0` makes the server reachable from other machines on your network

Once running:
- Dashboard: `http://127.0.0.1:3000/`
- API: `http://127.0.0.1:3000/api/stats`
- Health: `http://127.0.0.1:3000/health`

## Connect An Assistant

### MCP over stdio

```bash
claude mcp add memex -s user -- node /path/to/Memex/scripts/mcp-server.mjs
```

### MCP over Streamable HTTP

See [docs/remote-setup.md](docs/remote-setup.md).

That path supports:
- `/mcp` HTTP transport
- API-key auth
- reverse-proxy deployment
- remote clients

## Common Commands

```bash
# Status
node scripts/memex-loader.js status

# List projects
node scripts/memex-loader.js list

# Keyword search
node scripts/memex-loader.js search docker

# Semantic search
node scripts/memex-loader.js semantic "deployment work"

# Build bloom filter
node scripts/bloom-filter.js build

# View bloom stats
node scripts/bloom-filter.js stats

# Generate/inspect embeddings
node scripts/vector-search.js generate
node scripts/vector-search.js stats

# Find duplicate/similar sessions
node scripts/vector-search.js duplicates --threshold 0.9 --limit 10
node scripts/vector-search.js duplicates --json
```

## Data Model

At a high level:

```text
index.json
summaries/projects/<project>/sessions-index.json
summaries/projects/<project>/sessions/<session-id>.json
content/projects/<project>/sessions/<yyyy-mm>/<session-id>.md
.cache/*
.neural/*
```

Important parts:
- `index.json`: compact top-level project/topic index
- `summaries/projects/*/sessions-index.json`: lightweight session listing per project
- `summaries/projects/*/sessions/*.json`: detailed session records when present
- `content/projects/*`: optional markdown notes
- `.cache/`: bloom filter, embeddings cache, and related runtime artifacts
- `.neural/`: graph, bundles, and other binary/search artifacts

## Architecture Summary

The repo has four main surfaces:

1. Storage and indexing
   - file-backed session records
   - project/topic indexes
   - lock-protected atomic writes

2. Retrieval
   - quick lookup
   - keyword search
   - semantic search
   - duplicate/similarity helpers

3. Interfaces
   - CLI commands
   - REST API
   - web UI
   - MCP tools

4. Integrations
   - git-hook capture
   - AgentBridge events
   - remote MCP deployment

## Validation Notes

The current repo state supports these claims:
- MCP server exists
- HTTP MCP transport exists
- web UI exists
- session decay exists
- concurrency-safe writes exist
- validation/error-contract logic exists for MCP `remember`

Several old GitHub issues were still open even though the code was already present. Those have been reviewed and the clearly completed ones were closed.

## Limitations

- Semantic search depends on embeddings/model availability
- Topic extraction is still fairly heuristic
- Shared multi-user memory is not solved
- The repository currently contains a lot of checked-in memory/sample data, which makes it noisier than a clean product repo

## Repo Layout

```text
scripts/     runtime, CLI, servers, MCP tools
tests/       node:test coverage
web/         dashboard UI
docs/        setup and operational docs
summaries/   stored session indexes and records
metadata/    project metadata
content/     optional detailed notes
```

## Recommended Next Steps

If you are evaluating Memex:
- run `node scripts/memex-loader.js status`
- save 2-3 real sessions
- test keyword search and semantic search
- start the dashboard
- connect one assistant through MCP

If you are improving Memex:
- keep the README aligned with actual shipped behavior
- continue reducing stale checked-in data
- decide whether this should stay a personal-tool repo or become a cleaner reusable product

## Related Docs

- [QUICKSTART.md](QUICKSTART.md)
- [CHEATSHEET.md](CHEATSHEET.md)
- [HOW-IT-WORKS.md](HOW-IT-WORKS.md)
- [docs/remote-setup.md](docs/remote-setup.md)
- [MESSAGEPACK-MIGRATION.md](MESSAGEPACK-MIGRATION.md)
