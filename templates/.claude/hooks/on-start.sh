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
