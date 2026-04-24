#!/bin/bash
# Setup Codicil auto-load for any project
# Usage: Run this from the project root

set -e

PROJECT_ROOT="$(pwd)"
CODICIL_PATH="${CODICIL_PATH:-$HOME/code/Codicil}"

echo "Setting up Codicil auto-load for $(basename "$PROJECT_ROOT")..."

mkdir -p "$PROJECT_ROOT/.agents/hooks"

cat > "$PROJECT_ROOT/.agents/CODICIL.md" <<'EOT'
# Codicil - Shared Project Memory

Auto-loaded on assistant startup.

## What Codicil Provides
- Global standards (commit, PR, branching, code, security)
- Project-specific context (auto-detected)
- Cross-project knowledge lookup
- Token-efficient retrieval from compact indexes

## Quick Commands
```bash
codicil startup
codicil quick "commit"
codicil search <query>
save-session "summary" --topics tag1,tag2
```
EOT

cat > "$PROJECT_ROOT/.agents/hooks/on-start.sh" <<'EOT'
#!/bin/bash
CODICIL_PATH="${CODICIL_PATH:-$HOME/code/Codicil}"

if [ ! -d "$CODICIL_PATH" ]; then
  exit 0
fi

# Optional auto-update (set CODICIL_REPO_URL if desired)
if [ -n "$CODICIL_REPO_URL" ]; then
  (
    cd "$CODICIL_PATH" || exit
    if ! git remote | grep -q "^upstream$"; then
      git remote add upstream "$CODICIL_REPO_URL" 2>/dev/null || true
    fi
    git fetch upstream --quiet 2>/dev/null || true
  ) &
fi

node "$CODICIL_PATH/scripts/codicil-loader.js" startup >/dev/null 2>&1 || true
EOT

chmod +x "$PROJECT_ROOT/.agents/hooks/on-start.sh"

echo "Done. Created:"
echo "  - .agents/CODICIL.md"
echo "  - .agents/hooks/on-start.sh"
