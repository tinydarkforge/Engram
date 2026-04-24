# Memex Cheatsheet

Quick reference for all Memex commands, API endpoints, and MCP tools.

---

## CLI Commands

### memex-loader.js (Main CLI)

```bash
node scripts/memex-loader.js <command> [args]

# Or with alias:
memex <command> [args]
```

| Command | Description |
|---------|-------------|
| `startup` | Load index, detect project, show context |
| `status` | Show system status (index, cache, bloom, AgentBridge) |
| `quick "query"` | Answer from index only (instant) |
| `search <query>` | Keyword search across all projects |
| `semantic "query"` | AI-powered search by meaning |
| `list` | List all indexed projects |
| `load <project>` | Load full project context |

### remember (Session Capture)

```bash
./scripts/remember [summary] [options]

# Modes:
./scripts/remember                              # Auto-capture from git changes
./scripts/remember "what you did"               # Quick save with auto-topics
./scripts/remember "summary" --topics a,b,c     # Full control
./scripts/remember --interactive                 # Prompted input
./scripts/remember --auto                        # Git hook mode
```

### neural-memory.js (Git Search)

```bash
node scripts/neural-memory.js <command>

search "query"    # Search git commit history
build             # Rebuild git index
stats             # Show index statistics
```

### Ledger Commands (Phase 9-10)

```bash
# Transform assertions with confirmation
node scripts/transform.js [options]
  --plane <plane>              # Default: project:Memex
  --action <action>            # all|promote|verify|fossilize|weight
  --no-dry-run                 # Execute (default is dry-run)
  --confidence <f>             # Min confidence for promotion (default: 0.7)
  --stale-days <n>            # Days before state_bound needs verify (default: 14)
  --yes                        # Skip confirmation prompt

# Detect contradictions in a plane
node scripts/contradiction-sentinel.js --plane project:Memex

# Query ledger facts
node scripts/ledger.js query project:Memex
```

---

## npm Scripts

```bash
npm start                    # Start web dashboard (port 3000)
npm test                     # Run all tests
npm run startup              # Load Memex context
npm run status               # System status
npm run search -- <query>    # Keyword search
npm run semantic -- "query"  # Semantic search
npm run manifest             # Generate manifest
npm run bloom:build          # Build bloom filter
npm run bloom:stats          # Bloom filter stats
npm run lazy:convert         # Convert to lazy loading format
npm run lazy:stats           # Lazy loading stats
npm run git:index            # Build git commit index
npm run git:query            # Query git index
npm run semantic:stats       # Vector search stats
```

---

## Web Dashboard

Start: `npm start` or `PORT=8080 node scripts/server.js`

Open: `http://localhost:3000`

### Views

| View | Description |
|------|-------------|
| Dashboard | Overview stats, projects, topics, recent sessions, AgentBridge status |
| Search | Keyword and semantic search with time decay toggle |
| Graph | Interactive concept relationship graph (vis.js) |
| Sessions | Browse sessions by project |

---

## REST API

Base URL: `http://localhost:3000/api`

### Data Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Dashboard overview (sessions, projects, topics) |
| GET | `/api/projects` | All projects sorted by session count |
| GET | `/api/sessions/:project?limit=N` | Sessions for a project |
| GET | `/api/topics?limit=N` | Top topics with session counts |
| GET | `/api/search?q=query&limit=N` | Keyword search |
| POST | `/api/semantic-search` | Semantic search `{query, limit, useDecay}` |
| GET | `/api/graph` | Concept graph (vis.js nodes + edges) |

### AgentBridge Control

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agentbridge/status` | Consumer + bridge connection status |
| POST | `/api/agentbridge/start` | Start event polling |
| POST | `/api/agentbridge/stop` | Stop event polling |

---

## MCP Tools

Configure in your AI assistant:

```json
{
  "mcpServers": {
    "memex": {
      "command": "node",
      "args": ["/path/to/Memex/scripts/mcp-server.mjs"]
    }
  }
}
```

### Available Tools

| Tool | Description | Required Args |
|------|-------------|---------------|
| `neural_search` | Semantic search across all sessions | `query` |
| `get_bundle` | Pre-compiled project context | `project` |
| `list_projects` | All projects with stats | - |
| `recent_sessions` | Latest sessions across projects | - |
| `get_topics` | Top topics with counts | - |
| `query_concept` | Knowledge graph lookup | `concept` |
| `cross_project_search` | Search across all repos | `query` |
| `ledger_ingest` | Create assertion | `plane, claim, source_spans` |
| `ledger_query` | Query assertions by plane | `plane` |
| `ledger_select_context` | Get facts for prompt (budget-aware) | `plane, budget` |
| `ledger_stats` | Assertion statistics | - |
| `ledger_scan_sentinel` | Detect contradictions | `plane` |
| `ledger_run_verifications` | Verify state_bound facts | `plane` |
| `ledger_transform` | Bulk transform with confirmation | `plane` |

### MCP Resources

| URI | Description |
|-----|-------------|
| `memex://stats` | System overview statistics |
| `memex://graph` | Concept graph summary |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MEMEX_PATH` | Path to Memex data directory | Auto-detected |
| `REPOS_ROOT` | Parent directory of all repos | `../` from MEMEX_PATH |
| `AGENTBRIDGE_URL` | AgentBridge server URL (enables integration) | unset (disabled) |
| `AGENTBRIDGE_TOKEN` | Auth token for AgentBridge | unset |
| `PORT` | Web dashboard port | `3000` |
| `DEBUG` | Show stack traces on errors | unset |

---

## File Structure

```
Memex/
├── index.json                         # Main index (4KB)
├── summaries/projects/
│   └── <Project>/
│       ├── sessions-index.json        # Session list (lightweight)
│       └── sessions/<id>.json         # Full session details
├── .cache/
│   └── memex.db                       # Assertion ledger (SQLite)
├── .neural/
│   ├── bloom.json                     # Bloom filter
│   ├── graph.msgpack                  # Concept graph
│   ├── embeddings.msgpack             # Vector embeddings
│   ├── git-index.msgpack              # Git commit index
│   └── bundles/<project>.msgpack      # Pre-compiled context
├── scripts/                           # All executable scripts
│   ├── ledger.js                      # Assertion ledger (core CRUD)
│   ├── transform.js                   # Bulk transformation with user gate
│   ├── contradiction-sentinel.js      # Negation-based tension detection
│   ├── verification-hooks.js          # State-bound assertion verification
│   └── ...
├── tests/                             # Test suite (200+ tests)
└── web/                               # Dashboard (index.html, app.js, style.css)
```

---

## Common Workflows

### First-time setup
```bash
cd ~/code/Memex
npm install
node scripts/memex-loader.js startup
node scripts/bloom-filter.js build
```

### Save work at end of day
```bash
./scripts/remember "What you accomplished" --topics relevant,tags
```

### Search past work
```bash
# Keyword (fast)
node scripts/memex-loader.js search "docker deployment"

# Semantic (smarter)
node scripts/memex-loader.js semantic "how we handle auth"

# Git history
node scripts/neural-memory.js search "memory leak fix"
```

### Start web dashboard
```bash
npm start
# Open http://localhost:3000
```

### Deploy AGENTS.md to repos
```bash
node scripts/deploy-neural.js          # Deploy to all discovered repos
node scripts/deploy-neural.js --list   # List target repos
```
