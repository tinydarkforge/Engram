#!/bin/bash
# Compatibility wrapper for legacy setups.
# Use templates/agent-on-start-hook.sh for new setups.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/agent-on-start-hook.sh" "$@"
