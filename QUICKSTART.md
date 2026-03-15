# Getting Started with Memex

Memex gives your AI coding assistant (Claude, Cursor, Copilot) a **persistent memory**. It remembers what you built, your project conventions, and decisions across sessions — so your AI stops asking the same questions.

---

## Install (2 minutes)

```bash
# Clone
git clone https://github.com/Pamperito74/Memex.git
cd Memex

# Install dependencies
npm install

# Initialize Memex (first-time setup)
npm run setup

# Verify it works
node scripts/memex-loader.js status
```

You should see something like:
```
Memex v4.0.0 Status
========================================
Version:        4.0.0
Load time:      11ms
```

---

## Add a Shell Alias (optional but recommended)

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
export MEMEX_PATH="$HOME/path/to/Memex"
alias memex='node $MEMEX_PATH/scripts/memex-loader.js'
alias remember='$MEMEX_PATH/scripts/remember'
```

Then `source ~/.zshrc`. Now you can type `memex` instead of `node scripts/memex-loader.js`.

---

## Three Things You Can Do

### 1. Save what you worked on

After finishing work, save a session:

```bash
remember "Added user authentication with Google OAuth" --topics auth,oauth,google
```

Or let it auto-detect from your recent git changes:

```bash
remember --auto
```

Or install git hooks so it happens automatically on every commit:

```bash
/path/to/Memex/scripts/git-hook-capture.sh install
# Done. Every commit now auto-saves a session.
```

### 2. Search your memory

```bash
# Keyword search
memex search auth

# Quick lookup (instant, from index only)
memex quick "commit format"

# List all projects
memex list

# Full status
memex status
```

### 3. Connect it to your AI assistant

**Claude Code (MCP):**
```bash
claude mcp add memex -s user -- node /path/to/Memex/scripts/mcp-server.mjs
```

Now Claude can query your Memex directly — it knows your projects, conventions, and history.

**Remote MCP (Streamable HTTP):**
See [docs/remote-setup.md](docs/remote-setup.md) for running the HTTP server and connecting over the network.

**Other AI tools:** Use the REST API:
```bash
# Start the server
node scripts/server.js

# API available at http://localhost:3000/api/
# Dashboard at http://localhost:3000/
```

---

## What Gets Saved?

Each session captures:
- **Summary** — what you did in 1-2 sentences
- **Topics** — tags like `auth`, `docker`, `bugfix`
- **Project** — which repo this was in
- **Timestamp** — when it happened
- **Git info** — commit hash, files changed (if from git hook)

---

## How It Saves You Money

Without Memex, your AI reads ~50,000 tokens of context every time. With Memex, it reads a 4KB index and gets the answer in ~1,000 tokens.

| | Without Memex | With Memex |
|--|---------------|------------|
| Tokens per query | 50,000 | 1,000 |
| Startup time | 1000ms | 46ms |
| Monthly cost (est.) | $37 | $2 |

---

## Project Structure

```
Memex/
├── index.json          # Main knowledge index (4KB, loaded first)
├── summaries/          # Session data per project
├── scripts/            # CLI tools, servers, search
├── tests/              # 195 tests
└── web/                # Dashboard UI
```

---

## Troubleshooting

**"Cannot find index.json"**
Set the `MEMEX_PATH` environment variable to your Memex directory.

**"Could not detect project"**
Run from inside a git repository, or specify the project manually.

**"remember: command not found"**
Add the shell alias (see above), or run the script directly: `node scripts/remember.js "your summary"`

---

## Next Steps

- Run `memex status` to see what Memex knows
- Save your first session with `remember "what I did" --topics tag1,tag2`
- Install git hooks in your repos for zero-effort capture
- Check the [full README](README.md) for architecture details
- See [CHEATSHEET.md](CHEATSHEET.md) for all commands
