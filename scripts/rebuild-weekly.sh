#!/bin/bash
# Neural Memory Weekly Rebuild
#
# Rebuilds all neural structures including git index.
# Designed to be run via cron/launchd weekly.
#
# Usage:
#   ./rebuild-weekly.sh              # Run rebuild
#   ./rebuild-weekly.sh --install    # Install weekly schedule (macOS)
#   ./rebuild-weekly.sh --uninstall  # Remove schedule
#
# To install manually via crontab:
#   0 3 * * 0 /path/to/rebuild-weekly.sh >> /tmp/neural-rebuild.log 2>&1

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CODICIL_PATH="${CODICIL_PATH:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PLIST_PATH="$HOME/Library/LaunchAgents/com.codicil.neural-rebuild.plist"
LOG_FILE="/tmp/neural-rebuild.log"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

install_schedule() {
    log "Installing weekly schedule (Sundays at 3am)..."

    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.codicil.neural-rebuild</string>
    <key>ProgramArguments</key>
    <array>
        <string>$SCRIPT_DIR/rebuild-weekly.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>0</integer>
        <key>Hour</key>
        <integer>3</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>
    <key>StandardErrorPath</key>
    <string>$LOG_FILE</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
        <key>CODICIL_PATH</key>
        <string>$CODICIL_PATH</string>
    </dict>
</dict>
</plist>
EOF

    launchctl load "$PLIST_PATH" 2>/dev/null || true
    log "✅ Installed! Will run Sundays at 3am"
    log "   Plist: $PLIST_PATH"
    log "   Logs: $LOG_FILE"
}

uninstall_schedule() {
    log "Removing weekly schedule..."

    if [ -f "$PLIST_PATH" ]; then
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
        rm -f "$PLIST_PATH"
        log "✅ Removed"
    else
        warn "No schedule found"
    fi
}

run_rebuild() {
    log "Starting Neural Memory rebuild..."

    # Memory limit (prevent runaway)
    ulimit -v 524288 2>/dev/null || true  # 512MB

    cd "$CODICIL_PATH"

    # Run the build
    log "Building neural structures..."
    node --max-old-space-size=256 "$SCRIPT_DIR/neural-memory.js" build

    log "✅ Rebuild complete"

    # Show stats
    log "Index sizes:"
    ls -lh "$CODICIL_PATH/.neural/"*.msgpack 2>/dev/null | awk '{print "  " $9 ": " $5}'

    if [ -f "$CODICIL_PATH/.neural/git-index.msgpack" ]; then
        log "Git index: $(ls -lh "$CODICIL_PATH/.neural/git-index.msgpack" | awk '{print $5}')"
    fi
}

# Main
case "${1:-}" in
    --install)
        install_schedule
        ;;
    --uninstall)
        uninstall_schedule
        ;;
    *)
        run_rebuild
        ;;
esac
