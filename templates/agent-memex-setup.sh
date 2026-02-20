#!/bin/bash
# Setup Memex auto-load for any project
# Usage: Run this from the project root

set -e

PROJECT_ROOT="$(pwd)"
MEMEX_PATH="${MEMEX_PATH:-$HOME/code/Memex}"

echo "Setting up Memex auto-load for $(basename "$PROJECT_ROOT")..."

mkdir -p "$PROJECT_ROOT/.agents/hooks"

cat > "$PROJECT_ROOT/.agents/MEMEX.md" <<'EOT'
# Memex - Shared Project Memory

Auto-loaded on assistant startup.

## What Memex Provides
- Global standards (commit, PR, branching, code, security)
- Project-specific context (auto-detected)
- Cross-project knowledge lookup
- Token-efficient retrieval from compact indexes

## Quick Commands
```bash
memex startup
memex quick "commit"
memex search <query>
save-session "summary" --topics tag1,tag2
```
EOT

cat > "$PROJECT_ROOT/.agents/hooks/on-start.sh" <<'EOT'
#!/bin/bash
MEMEX_PATH="${MEMEX_PATH:-$HOME/code/Memex}"

if [ ! -d "$MEMEX_PATH" ]; then
  exit 0
fi

# Optional auto-update (set MEMEX_REPO_URL if desired)
if [ -n "$MEMEX_REPO_URL" ]; then
  (
    cd "$MEMEX_PATH" || exit
    if ! git remote | grep -q "^upstream$"; then
      git remote add upstream "$MEMEX_REPO_URL" 2>/dev/null || true
    fi
    git fetch upstream --quiet 2>/dev/null || true
  ) &
fi

node "$MEMEX_PATH/scripts/memex-loader.js" startup >/dev/null 2>&1 || true
EOT

chmod +x "$PROJECT_ROOT/.agents/hooks/on-start.sh"

echo "Done. Created:"
echo "  - .agents/MEMEX.md"
echo "  - .agents/hooks/on-start.sh"
