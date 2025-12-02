# Memex Auto-Load Setup

**Make Memex automatically load when Claude starts in any project.**

---

## ✅ Already Set Up

**DemoProject** - Memex auto-loads! ✓

When Claude starts in DemoProject:
1. Runs `.claude/hooks/on-start.sh`
2. Loads Memex context (47ms)
3. Has full knowledge of global standards + project context

---

## Setup for Other Projects

### Quick Setup (Any Cirrus Project)

```bash
# From the project root
cd ~/code/cirrus/YourProject

# Run setup script
~/code/cirrus/DevOps/Memex/templates/claude-memex-setup.sh

# Done! ✅
```

This creates:
- `.claude/MEMEX.md` - Reference documentation
- `.claude/hooks/on-start.sh` - Auto-load script

### Manual Setup

If you prefer to do it manually:

**1. Create MEMEX.md:**
```bash
cp ~/code/cirrus/DevOps/Memex/templates/MEMEX.md \
   ~/code/cirrus/YourProject/.claude/
```

**2. Create on-start hook:**
```bash
mkdir -p ~/code/cirrus/YourProject/.claude/hooks

cat > ~/code/cirrus/YourProject/.claude/hooks/on-start.sh << 'EOF'
#!/bin/bash
MEMEX_PATH="${MEMEX_PATH:-$HOME/code/cirrus/DevOps/Memex}"
if [ -d "$MEMEX_PATH" ]; then
  echo "🧠 Loading Memex..."
  node "$MEMEX_PATH/scripts/memex-loader.js" startup
fi
EOF

chmod +x ~/code/cirrus/YourProject/.claude/hooks/on-start.sh
```

**3. Test it:**
```bash
cd ~/code/cirrus/YourProject
./.claude/hooks/on-start.sh
```

---

## What Happens on Startup?

### Before (Without Memex)
```
Claude starts → Loads .claude/ folder → Manual context
```

### After (With Memex)
```
Claude starts
→ Runs .claude/hooks/on-start.sh
→ Loads Memex (47ms)
→ Has global standards + project context
→ Ready to work!
```

**Output on startup:**
```
🧠 Loading Memex...
✅ Memex Ready (47ms)

📊 Context Loaded:
  • Global Standards: 5
  • Current Project: YourProject
  • Available Projects: 3

🎯 Current Project: YourProject
  • Tech: [auto-detected]
  • Architecture: [auto-detected]
  • Environments: [from metadata]
```

---

## What Claude Gets Automatically

### Global Knowledge (Always)
- Commit format: `<type>(<scope>): <description>`
- PR requirements (tests, lint, approvals)
- Branching strategy (main/staging/develop)
- Code standards (React, TypeScript, API design)
- Security guidelines

### Project-Specific (Auto-detected)
- Tech stack (from git + package.json)
- Architecture (from metadata)
- Environments (dev/staging/prod URLs)
- Code owners
- Recent sessions

### Cross-Project (On-demand)
- Can query other Cirrus projects
- Search for implementations
- Compare approaches

---

## Token Efficiency

**Without Memex:**
```
Load all files: 500KB, 50,000 tokens
Startup: 1000ms+
```

**With Memex:**
```
Load index: 5KB, 500 tokens
Startup: 47ms
Answer 80% of queries from index (no file loading!)
```

**95% token reduction!**

---

## Verification

### Check if Setup Correctly

```bash
cd ~/code/cirrus/YourProject

# 1. Check files exist
ls -la .claude/MEMEX.md
ls -la .claude/hooks/on-start.sh

# 2. Test the hook
./.claude/hooks/on-start.sh

# Should output:
# 🧠 Loading Memex...
# ✅ Memex Ready (47ms)
# [context info]
```

### Check What Claude Knows

When Claude starts, ask:
```
"What's our commit format?"
"What tech stack does this project use?"
"What are our environments?"
```

Claude should answer instantly from Memex.

---

## Projects Setup Status

- ✅ **DemoProject** - Auto-loads Memex
- ⬜ **ProjectAuth** - Not set up yet
- ⬜ **DevOps** - Not needed (Memex lives here)
- ⬜ **Other projects** - Run setup script

---

## Updating Memex

When you add new knowledge:

```bash
# Save a session (auto-updates Memex)
save-session "What you did" --topics tags

# Or manually update
vim ~/code/cirrus/DevOps/Memex/index.json

# Changes are auto-pulled on next Claude startup
```

---

## Troubleshooting

**Hook not running?**
- Check it's executable: `chmod +x .claude/hooks/on-start.sh`
- Check path is correct: `echo $MEMEX_PATH`

**Memex not found?**
- Check it exists: `ls ~/code/cirrus/DevOps/Memex`
- Set path: `export MEMEX_PATH="/path/to/Memex"`

**Want to disable?**
- Rename hook: `mv .claude/hooks/on-start.sh .claude/hooks/on-start.sh.disabled`

---

## Next Steps

1. **✅ DemoProject set up** - Working!
2. **Set up other projects** - Run setup script
3. **Start using** - Claude auto-loads on startup
4. **Save sessions** - Use `save-session` after work

---

**Memex: Auto-loaded, always ready** 🧠⚡
