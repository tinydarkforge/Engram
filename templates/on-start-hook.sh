#!/bin/bash
# Neural Memory Auto-Load Hook
# Add to .claude/hooks/on-start.sh in any project
#
# This hook:
# 1. Auto-updates Memex from Pamperito74/Memex
# 2. Regenerates CLAUDE.md with latest Neural Memory
# 3. Starts Neural Daemon if not running

MEMEX_PATH="${MEMEX_PATH:-$HOME/code/cirrus/DevOps/Memex}"
PROJECT_NAME="${PROJECT_NAME:-$(basename $(git rev-parse --show-toplevel 2>/dev/null || pwd))}"

# Check if Memex exists
if [ ! -d "$MEMEX_PATH" ]; then
  echo "⚠️  Memex not found at $MEMEX_PATH" >&2
  exit 0
fi

# Auto-update Memex from <owner> (non-blocking, background)
(
  cd "$MEMEX_PATH" 2>/dev/null || exit

  # Ensure cirrus remote exists
  if ! git remote | grep -q "^cirrus$"; then
    git remote add cirrus https://github.com/Pamperito74/Memex.git 2>/dev/null
  fi

  # Check for local changes
  if git diff-index --quiet HEAD -- 2>/dev/null; then
    git fetch cirrus main --quiet 2>/dev/null
    LOCAL_HASH=$(git rev-parse HEAD 2>/dev/null)
    REMOTE_HASH=$(git rev-parse cirrus/main 2>/dev/null)

    if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
      git merge cirrus/main --ff-only --quiet 2>/dev/null
    fi
  fi
) &

# Regenerate CLAUDE.md with latest Neural Memory (quiet mode)
node "$MEMEX_PATH/scripts/deploy-neural.js" --project "$PROJECT_NAME" --quiet 2>/dev/null

# Start Neural Daemon if not running (non-blocking)
if [ ! -S "$MEMEX_PATH/.neural/daemon.sock" ]; then
  node "$MEMEX_PATH/scripts/neural-daemon.js" start >/dev/null 2>&1 &
fi

# Quick context output (optional - comment out if too verbose)
# node "$MEMEX_PATH/scripts/neural-memory.js" bundle "$PROJECT_NAME" 2>/dev/null
