#!/bin/bash
# Auto-update Neural Memory on significant commits
# Installed by deploy-neural.js

MEMEX_PATH="/Users/doceno/code/cirrus/DevOps/Memex"

# Only run on main/develop branches
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" == "main" || "$BRANCH" == "develop" || "$BRANCH" == "master" ]]; then
  # Rebuild in background (non-blocking)
  (cd "$MEMEX_PATH" && node scripts/neural-memory.js build > /dev/null 2>&1) &
fi
