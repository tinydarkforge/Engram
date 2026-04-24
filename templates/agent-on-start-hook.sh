#!/bin/bash
# Generic assistant startup hook for Codicil

CODICIL_PATH="${CODICIL_PATH:-$HOME/code/Codicil}"

if [ ! -d "$CODICIL_PATH" ]; then
  exit 0
fi

# Optional update from configured upstream
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
