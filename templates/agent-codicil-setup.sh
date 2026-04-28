#!/bin/bash
# Setup Engram auto-load for any project
# Usage: Run this from the project root

set -e

PROJECT_ROOT="$(pwd)"
ENGRAM_PATH="${ENGRAM_PATH:-$HOME/code/Engram}"

echo "Setting up Engram auto-load for $(basename "$PROJECT_ROOT")..."

mkdir -p "$PROJECT_ROOT/.agents/hooks"

cat > "$PROJECT_ROOT/.agents/ENGRAM.md" <<'EOT'
# Engram - Shared Project Memory

Auto-loaded on assistant startup.

## What Engram Provides
- Global standards (commit, PR, branching, code, security)
- Project-specific context (auto-detected)
- Cross-project knowledge lookup
- Token-efficient retrieval from compact indexes

## Quick Commands
```bash
engram startup
engram quick "commit"
engram search <query>
save-session "summary" --topics tag1,tag2
```
EOT

cat > "$PROJECT_ROOT/.agents/hooks/on-start.sh" <<'EOT'
#!/bin/bash
ENGRAM_PATH="${ENGRAM_PATH:-$HOME/code/Engram}"

if [ ! -d "$ENGRAM_PATH" ]; then
  exit 0
fi

# Optional auto-update (set ENGRAM_REPO_URL if desired)
if [ -n "$ENGRAM_REPO_URL" ]; then
  (
    cd "$ENGRAM_PATH" || exit
    if ! git remote | grep -q "^upstream$"; then
      git remote add upstream "$ENGRAM_REPO_URL" 2>/dev/null || true
    fi
    git fetch upstream --quiet 2>/dev/null || true
  ) &
fi

node "$ENGRAM_PATH/scripts/engram-loader.js" startup >/dev/null 2>&1 || true
EOT

chmod +x "$PROJECT_ROOT/.agents/hooks/on-start.sh"

echo "Done. Created:"
echo "  - .agents/ENGRAM.md"
echo "  - .agents/hooks/on-start.sh"
