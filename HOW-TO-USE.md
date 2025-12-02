# How to Use Memex

Simple guide for developers.

---

## Quick Setup (Do Once)

Add these aliases to your shell config (`~/.zshrc` or `~/.bashrc`):

```bash
# Add to ~/.zshrc
export MEMEX="$HOME/code/cirrus/DevOps/Memex"
alias memex='node $MEMEX/scripts/memex-loader.js'
alias save-session='node $MEMEX/scripts/save-session.js'

# Reload
source ~/.zshrc
```

Now you can use `memex` and `save-session` from **any directory**.

---

## From Any Repository

### 1. Check What Memex Knows

```bash
# From anywhere (DemoProject, ProjectAuth, etc.)
cd ~/code/cirrus/DemoProject

# See full context
memex startup

# Quick questions
memex quick "commit format"
memex quick "pr requirements"
memex quick "branching"

# Search across all projects
memex search authentication
memex search "rate limiting"

# List all projects
memex list
```

### 2. Save Your Work Session

After working on something:

```bash
# Quick save
save-session "Implemented OAuth2 authentication" --topics auth,oauth,google

# Interactive (asks questions)
save-session --interactive
```

**That's it!** Works from any Cirrus repository.

---

## Without Aliases (Full Path)

If you didn't set up aliases:

```bash
# From DemoProject
cd ~/code/cirrus/DemoProject

# Check context
node ~/code/cirrus/DevOps/Memex/scripts/memex-loader.js startup

# Save session
node ~/code/cirrus/DevOps/Memex/scripts/save-session.js \
  "Your summary" --topics tag1,tag2
```

---

## Common Commands

### Ask Memex

```bash
# Commit format
memex quick "commit"
→ Returns: { format: "<type>(<scope>): <description>", ... }

# PR requirements
memex quick "pr"
→ Returns: { required_checks: ["tests", "lint", ...], ... }

# Current project info
memex quick "environment"
→ Returns: { dev: "https://dev...", staging: "...", ... }
```

### Search Knowledge

```bash
# Find authentication implementations
memex search auth
→ Shows which projects have auth, how many sessions

# Find rate limiting
memex search "rate limiting"
→ Shows if implemented in any project

# Find specific tech
memex search redis
→ Shows projects using Redis
```

### Save Sessions

```bash
# After implementing a feature
save-session "Added user authentication with JWT" --topics auth,jwt,security

# After fixing a bug
save-session "Fixed rate limiting bug in API" --topics bug,api,rate-limit

# Interactive mode (prompts for details)
save-session --interactive
```

---

## What Gets Saved?

When you run `save-session`:

1. **Auto-detected:**
   - Current project (from git remote)
   - Date/time
   - Git changes (files modified, lines added/removed)

2. **You provide:**
   - Summary (1-2 sentences)
   - Topics/tags
   - Optional detailed notes

3. **Saved to:**
   - `Memex/summaries/projects/YourProject/sessions-index.json`
   - Updates main index
   - Commits to git
   - Pushes to remote (background)

---

## Example Workflow

### Morning: Start Work

```bash
cd ~/code/cirrus/DemoProject

# See what you know
memex startup

# Output:
# ✅ Memex Ready (48ms)
# 📊 Context Loaded:
#   • Global Standards: 5
#   • Current Project: DemoProject
#   • Available Projects: 3
```

### During: Need Info from Another Project

```bash
# How did we handle OAuth in ProjectAuth?
memex search oauth

# If you need more details, ask Claude:
# "Load the OAuth implementation from ProjectAuth"
# Claude will use memex-loader to fetch it
```

### Evening: Save Your Work

```bash
# What did you do today?
save-session --interactive

# Prompts:
# Summary: Implemented rate limiting for API endpoints
# Topics: api,rate-limiting,redis,performance
# Detailed notes? y/n

# ✅ Session saved to Memex
# ✅ Available to all projects now
```

---

## For Claude Users

When you have Claude open in a repo, Claude can:

1. **Auto-load** Memex on startup
2. **Answer questions** from index (no file loading)
3. **Search across projects** when you ask
4. **Load other project context** on-demand

You can also **explicitly ask**:

```
"@memex what's our commit format?"
"@memex search all projects for authentication"
"@memex load ProjectAuth"
```

But Claude will do this automatically when relevant.

---

## Common Questions

**Q: Where is Memex?**
A: `~/code/cirrus/DevOps/Memex`

**Q: Does it work from any repo?**
A: Yes! Use the full path or set up aliases.

**Q: How do I see saved sessions?**
A: `cat $MEMEX/summaries/projects/DemoProject/sessions-index.json | jq .sessions`

**Q: Can I edit the index manually?**
A: Yes! Edit `$MEMEX/index.json` directly.

**Q: How do I add a new project?**
A: Just use `save-session` from that project. It auto-creates the project entry.

**Q: Does it require git?**
A: For auto-commit/push, yes. But core functionality works without git.

---

## Troubleshooting

### "Could not detect project"

Make sure you're in a git repo with a remote:
```bash
git remote -v
# Should show: git@github.com:<owner>/YourProject.git
```

Or create `.claude/memex.json`:
```json
{ "memex": true, "project_name": "YourProject" }
```

### "Command not found: memex"

Either:
1. Add aliases to `~/.zshrc` (see Quick Setup above)
2. Use full path: `node ~/code/cirrus/DevOps/Memex/scripts/memex-loader.js`

### "Cannot find module"

Make sure you're using Node.js:
```bash
node --version
# Should be v14+
```

---

## TL;DR

```bash
# Setup (once)
echo 'alias memex="node $HOME/code/cirrus/DevOps/Memex/scripts/memex-loader.js"' >> ~/.zshrc
echo 'alias save-session="node $HOME/code/cirrus/DevOps/Memex/scripts/save-session.js"' >> ~/.zshrc
source ~/.zshrc

# Daily use
memex startup          # See context
memex quick "commit"   # Quick answer
memex search auth      # Search projects
save-session "Summary" --topics tag1,tag2   # Save work
```

**That's it!** 🎯
