#!/bin/bash
# Setup Memex auto-load for any Cirrus project
# Usage: Run this from the root of any Cirrus repository

set -e

PROJECT_ROOT="$(pwd)"
MEMEX_PATH="${MEMEX_PATH:-$HOME/code/cirrus/DevOps/Memex}"

echo "🧠 Setting up Memex auto-load for $(basename $PROJECT_ROOT)..."

# Create .claude directory if not exists
mkdir -p "$PROJECT_ROOT/.claude/hooks"

# Create MEMEX.md reference file
cat > "$PROJECT_ROOT/.claude/MEMEX.md" << 'EOF'
# Memex - Shared Consciousness

**Auto-loaded on Claude startup.**

## What is Memex?

Memex is Claude's shared memory across all Cirrus projects.

**Provides:**
- ✅ Global standards (commit, PR, branching, code, security)
- ✅ Project-specific context (auto-detected)
- ✅ Cross-project knowledge (query other repos)
- ✅ Token-efficient (80% queries answered from index)

**Location:** `~/code/cirrus/DevOps/Memex`

## Quick Reference

**Commit Format:**
```
<type>(<scope>): <description>

Types: feat, fix, docs, style, refactor, test, chore
Example: feat(auth): add OAuth2 login
```

**PR Requirements:**
- Tests added/updated
- Self-review completed
- Lint/typecheck/build passes
- At least 1 approval

**Branching:**
- main → Production
- staging → Pre-production (optional)
- develop → Development
- feature/* → Feature branches

## User Commands

```bash
memex startup              # See full context
memex quick "commit"       # Quick answer
memex search <query>       # Search all projects
save-session "summary" --topics tags  # Save work
```

## For Claude

On startup, load Memex:
```javascript
const memex = require('~/code/cirrus/DevOps/Memex/scripts/memex-loader.js');
const loader = new memex();
const context = loader.startup();
```

Context provides global standards + current project metadata for token-efficient answers.

---

**Auto-loaded via .claude/hooks/on-start.sh** 🧠⚡
EOF

# Create on-start hook
cat > "$PROJECT_ROOT/.claude/hooks/on-start.sh" << 'EOF'
#!/bin/bash
# Auto-load Memex on Claude startup

MEMEX_PATH="${MEMEX_PATH:-$HOME/code/cirrus/DevOps/Memex}"

# Check if Memex exists
if [ ! -d "$MEMEX_PATH" ]; then
  echo "⚠️  Memex not found at $MEMEX_PATH"
  exit 0
fi

# Load Memex context
echo "🧠 Loading Memex..."
node "$MEMEX_PATH/scripts/memex-loader.js" startup

# Sync latest knowledge (background, non-blocking)
(cd "$MEMEX_PATH" && git pull --quiet origin main 2>/dev/null &)
EOF

# Make hook executable
chmod +x "$PROJECT_ROOT/.claude/hooks/on-start.sh"

echo "✅ Memex setup complete!"
echo ""
echo "Created files:"
echo "  - .claude/MEMEX.md (reference)"
echo "  - .claude/hooks/on-start.sh (auto-load script)"
echo ""
echo "Next time Claude starts in this project, Memex will auto-load."
echo ""
echo "Test it now:"
echo "  .claude/hooks/on-start.sh"
