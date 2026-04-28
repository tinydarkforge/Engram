#!/bin/bash
# Generic assistant startup hook for Engram

ENGRAM_PATH="${ENGRAM_PATH:-$HOME/code/Engram}"

if [ ! -d "$ENGRAM_PATH" ]; then
  exit 0
fi

# Optional update from configured upstream
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
