# Memex - Quick Start Guide

Get Memex running in 5 minutes.

---

## Step 1: Setup (One Time)

```bash
# Make scripts executable
cd ~/code/cirrus/DevOps/Memex/scripts
chmod +x memex-loader.js recuerda.js

# Test it works
node memex-loader.js startup
```

Expected output:
```
✅ Memex Ready (87ms)

📊 Context Loaded:
  • Global Standards: 5 (commit, PR, branching, code, security)
  • Current Project: DevOps
  • Available Projects: 2
  • Total Sessions: 0
```

---

## Step 2: Add to Your Projects

### Option A: Auto-detect (Recommended)

Memex auto-detects projects from git remote. No configuration needed!

```bash
cd ~/code/cirrus/DemoProject
node ~/code/cirrus/DevOps/Memex/scripts/memex-loader.js startup

# Output:
# ✅ Memex Ready (92ms)
# 🎯 Current Project: DemoProject
```

### Option B: Manual Config

Create `.claude/memex.json`:

```json
{
  "enabled": true,
  "memex_path": "~/code/cirrus/DevOps/Memex"
}
```

---

## Step 3: Try It Out

### Query Memex

```bash
# From any Cirrus project directory

# Quick answers (from index only - instant)
node ~/code/cirrus/DevOps/Memex/scripts/memex-loader.js quick "commit format"

# Output:
{
  "format": "<type>(<scope>): <description>",
  "example": "feat(auth): add OAuth2 login",
  "types": {
    "feat": "New feature",
    "fix": "Bug fix",
    ...
  }
}
```

### Search Projects

```bash
node ~/code/cirrus/DevOps/Memex/scripts/memex-loader.js search auth

# Output:
[
  {
    "type": "topic",
    "topic": "auth",
    "projects": ["DemoProject"],
    "session_count": 0
  }
]
```

### List Projects

```bash
node ~/code/cirrus/DevOps/Memex/scripts/memex-loader.js list

# Output:
[
  {
    "name": "DemoProject",
    "description": "ASL translation platform...",
    "tech_stack": ["React", "TypeScript", "NestJS", ...],
    "session_count": 0
  },
  ...
]
```

---

## Step 4: Save Your First Session

```bash
cd ~/code/cirrus/DemoProject

# Quick save
node ~/code/cirrus/DevOps/Memex/scripts/recuerda.js \
  "Set up Memex memory system" \
  --topics memex,setup,memory

# Output:
# ✅ Session saved: ct-2025-11-29-memex
```

### Interactive Mode

```bash
node ~/code/cirrus/DevOps/Memex/scripts/recuerda.js --interactive

# Prompts:
# 📝 Recuerda - Save session for DemoProject
#
# Summary (1-2 sentences): Added OAuth2 authentication with Google
# Topics (comma-separated): auth,oauth,google
#
# Do you want to add detailed notes? (y/N): y
# Enter detailed notes (Ctrl+D when done):
# [Type your notes, then Ctrl+D]
#
# 💾 Saving session...
# ✅ Session saved: ct-2025-11-29-oauth
```

---

## Step 5: Make It Easier (Optional)

### Add Aliases

Add to `~/.zshrc` or `~/.bashrc`:

```bash
# Memex shortcuts
export MEMEX_PATH="$HOME/code/cirrus/DevOps/Memex"
alias memex='node $MEMEX_PATH/scripts/memex-loader.js'
alias recuerda='node $MEMEX_PATH/scripts/recuerda.js'

# Reload
source ~/.zshrc
```

Now you can use:

```bash
memex startup
memex quick "commit format"
memex search auth
memex list

recuerda "Implemented feature X" --topics feature,x
recuerda --interactive
```

---

## How Claude Uses It

When you start Claude in any Cirrus project:

```
1. [10ms] Claude detects project from git remote
2. [50ms] Loads Memex index.json (5KB)
3. [40ms] Loads project metadata (2KB)
4. [Ready] Claude has full context

Total: 87ms, 7KB loaded

Now Claude knows:
✓ All global standards (commit, PR, branching, code)
✓ Current project (tech stack, architecture, conventions)
✓ All available projects
✓ All session summaries

Most questions answered from index alone - no file loading needed!
```

---

## Example Workflows

### Workflow 1: Start Working on DemoProject

```bash
cd ~/code/cirrus/DemoProject
claude

# Claude auto-loads Memex
# You can now ask:
# - "What's our commit format?"
# - "What environments do we have?"
# - "What's our PR process?"
# All answered instantly from index
```

### Workflow 2: Learn from Another Project

```bash
cd ~/code/cirrus/NewProject

# Ask Claude:
"How did we implement authentication in ProjectAuth?"

# Claude:
# 1. Checks index → ProjectAuth has 'auth' topic
# 2. Loads ProjectAuth sessions-index.json
# 3. Finds OAuth2 session
# 4. Loads that specific session if needed
# 5. Answers with context from ProjectAuth
```

### Workflow 3: Save Session After Work

```bash
# After working on a feature
recuerda --interactive

# Summary: Implemented rate limiting for API endpoints
# Topics: api,rate-limiting,redis,performance
# Detailed notes: [describe implementation]

# ✅ Saved to Memex
# ✅ Auto-committed to git
# ✅ Available to all projects now
```

---

## Common Patterns

### Quick Checks

```bash
# Check commit format
memex quick "commit"

# Check PR requirements
memex quick "pr"

# Check branching strategy
memex quick "branch"
```

### Cross-Project Search

```bash
# Find all sessions about authentication
memex search authentication

# Find projects using React
memex search react

# Find rate limiting implementations
memex search "rate limiting"
```

### Session Management

```bash
# Quick session save
recuerda "Did X" --topics x,y,z

# Detailed session save
recuerda --interactive

# View saved sessions
cat ~/code/cirrus/DevOps/Memex/summaries/projects/DemoProject/sessions-index.json | jq '.sessions[0]'
```

---

## Verification

### Check It's Working

```bash
# 1. Memex loads successfully
memex startup
# Should show: ✅ Memex Ready

# 2. Project detection works
cd ~/code/cirrus/DemoProject
memex startup
# Should show: Current Project: DemoProject

# 3. Quick queries work
memex quick "commit"
# Should return commit format

# 4. Session saving works
recuerda "Test session" --topics test
# Should create session file
```

### Check Files Created

```bash
tree ~/code/cirrus/DevOps/Memex/

# Should see:
# ├── index.json ✓
# ├── metadata/projects/DemoProject.json ✓
# ├── summaries/projects/DemoProject/sessions-index.json ✓
# └── scripts/memex-loader.js ✓
```

---

## Performance Check

```bash
# Time the startup
time memex startup

# Should be:
# real    0m0.087s  (<100ms)
```

If slower than 200ms, check:
- Is index.json small enough? (<10KB)
- Are you loading content unnecessarily?
- Is git slow? (git pull in background)

---

## Troubleshooting

### "Could not detect project"

**Problem:** Memex can't detect which project you're in

**Solution:**
1. Make sure you're in a git repository: `git remote -v`
2. Or add `.claude/memex.json` with project name
3. Or use directory name matching project in index.json

### "Memex index not found"

**Problem:** Can't find index.json

**Solution:**
```bash
# Check path
ls ~/code/cirrus/DevOps/Memex/index.json

# Set correct path
export MEMEX_PATH="/correct/path/to/Memex"
```

### "Session not saving"

**Problem:** recuerda fails to save

**Solution:**
1. Check you're in a recognized project
2. Check Memex path is correct
3. Check git is configured: `git config user.name`

---

## Next Steps

1. ✅ **You're ready!** Memex is working
2. 📝 **Start saving sessions** - Use `recuerda` after each work session
3. 🌍 **Add global standards** - Extract from DemoProject
4. 🎯 **Add more projects** - Set up ProjectAuth, etc.
5. 🔍 **Optional: Embeddings** - Add semantic search

---

## Quick Reference Card

```bash
# Startup
memex startup                              # Load full context
memex quick "commit"                       # Quick answer
memex search <query>                       # Search projects
memex list                                 # List all projects

# Save sessions
recuerda "Summary" --topics tag1,tag2,tag3     # Quick save
recuerda --interactive                          # Interactive mode

# View data
cat $MEMEX_PATH/index.json | jq           # View index
cat $MEMEX_PATH/summaries/projects/DemoProject/sessions-index.json | jq '.sessions[0]'  # View latest session
```

---

**You're all set! Memex is ready to remember everything.** 🧠✨
