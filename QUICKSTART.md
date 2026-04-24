# Quickstart

Codicil is a local memory layer for engineering work. You save short session records, then query them later from CLI, HTTP, web UI, or MCP.

## 1. Install

```bash
git clone https://github.com/tinydarkforge/codicil.git
cd codicil
npm install
npm run setup
node scripts/codicil-loader.js status
```

If status shows warnings:
- run `npm run migrate` if schema versions are behind
- create `metadata/projects/<Project>.json` if you want richer project metadata
- run `npm run metrics:backfill` if you want metrics rebuilt from existing sessions
- run `node scripts/vector-search.js generate` if you want semantic search embeddings

## 2. Save A Session

Manual save:

```bash
./scripts/remember "Implemented OAuth callback handling" --topics auth,oauth
```

Interactive mode:

```bash
./scripts/remember --interactive
```

Git-hook capture:

```bash
/path/to/Codicil/scripts/git-hook-capture.sh install
```

That makes Codicil useful quickly: save a few real sessions before judging the search quality.

## 3. Query Memory

Quick lookup:

```bash
node scripts/codicil-loader.js quick "commit format"
```

Keyword search:

```bash
node scripts/codicil-loader.js search auth
```

Semantic search:

```bash
node scripts/codicil-loader.js semantic "authentication work"
```

Duplicate detection:

```bash
node scripts/vector-search.js duplicates --threshold 0.9 --limit 10
```

Status and project list:

```bash
node scripts/codicil-loader.js status
node scripts/codicil-loader.js list
```

## 4. Run The Dashboard / API

Local-only default:

```bash
node scripts/server.js
```

Custom port:

```bash
PORT=8080 node scripts/server.js
```

Expose on your LAN:

```bash
HOST=0.0.0.0 node scripts/server.js
```

Default local URLs:
- Dashboard: `http://127.0.0.1:3000/`
- API: `http://127.0.0.1:3000/api/stats`
- Health: `http://127.0.0.1:3000/health`

Use `HOST=0.0.0.0` only when you intentionally want other machines on your network to connect.

## 5. Connect An Assistant

MCP over stdio:

```bash
claude mcp add codicil -s user -- node /path/to/Codicil/scripts/mcp-server.mjs
```

Remote MCP over HTTP:

See [docs/remote-setup.md](docs/remote-setup.md).

## Optional Shell Aliases

```bash
export CODICIL_PATH="$HOME/path/to/Codicil"
alias codicil='node $CODICIL_PATH/scripts/codicil-loader.js'
alias remember='$CODICIL_PATH/scripts/remember'
```

## What Gets Stored

Each session usually includes:
- summary
- topics
- project
- timestamp
- optional git-change metadata
- optional detailed notes

Main storage locations:
- `index.json`
- `summaries/projects/*/sessions-index.json`
- `summaries/projects/*/sessions/*.json`
- `content/projects/*`

## Good First Validation

If you want to validate whether Codicil is useful for you:
1. Save 3-5 sessions from real work.
2. Run both keyword and semantic search.
3. Open the dashboard.
4. Connect one assistant over MCP.
5. Decide whether the retrieved context is actually reducing repeated explanation.

## Related Docs

- [README.md](README.md)
- [CHEATSHEET.md](CHEATSHEET.md)
- [HOW-IT-WORKS.md](HOW-IT-WORKS.md)
- [docs/remote-setup.md](docs/remote-setup.md)
