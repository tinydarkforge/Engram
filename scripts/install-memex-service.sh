#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MEMEX_PATH_DEFAULT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  echo "Usage: install-memex-service.sh [--memex-path PATH] [--user USER] [--port PORT] [--bind ADDR]"
  echo "  --memex-path PATH   Memex install path (default: $MEMEX_PATH_DEFAULT)"
  echo "  --user USER         Service user (default: memex)"
  echo "  --port PORT         MCP port (default: 3000)"
  echo "  --bind ADDR         Bind address (default: 0.0.0.0)"
  echo "  --api-key KEY       MCP API key (required)"
}

MEMEX_PATH="$MEMEX_PATH_DEFAULT"
SERVICE_USER="memex"
MCP_PORT="3000"
MCP_BIND_ADDR="0.0.0.0"
MCP_API_KEY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --memex-path)
      MEMEX_PATH="$2"
      shift 2
      ;;
    --user)
      SERVICE_USER="$2"
      shift 2
      ;;
    --port)
      MCP_PORT="$2"
      shift 2
      ;;
    --bind)
      MCP_BIND_ADDR="$2"
      shift 2
      ;;
    --api-key)
      MCP_API_KEY="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$MCP_API_KEY" ]]; then
  echo "Error: --api-key is required"
  usage
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (use sudo)."
  exit 1
fi

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd -r -s /bin/false "$SERVICE_USER"
fi

mkdir -p /etc/memex
cat > /etc/memex/memex.env <<EOF
NODE_ENV=production
MEMEX_PATH=$MEMEX_PATH
MCP_API_KEY=$MCP_API_KEY
MCP_BIND_ADDR=$MCP_BIND_ADDR
MCP_PORT=$MCP_PORT
EOF

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$MEMEX_PATH"
chown -R "$SERVICE_USER:$SERVICE_USER" "$MEMEX_PATH"

cp "$SCRIPT_DIR/memex-mcp.service.template" /etc/systemd/system/memex-mcp.service
sed -i "s|/opt/memex|$MEMEX_PATH|g" /etc/systemd/system/memex-mcp.service
sed -i "s|User=memex|User=$SERVICE_USER|g" /etc/systemd/system/memex-mcp.service
sed -i "s|Group=memex|Group=$SERVICE_USER|g" /etc/systemd/system/memex-mcp.service

systemctl daemon-reload
systemctl enable memex-mcp
systemctl restart memex-mcp

echo "Memex MCP service installed and started."
systemctl status memex-mcp --no-pager

