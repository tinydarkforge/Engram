#!/bin/bash
# Generic assistant startup hook for Memex

MEMEX_PATH="${MEMEX_PATH:-$HOME/code/Memex}"

if [ ! -d "$MEMEX_PATH" ]; then
  exit 0
fi

# Optional update from configured upstream
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
