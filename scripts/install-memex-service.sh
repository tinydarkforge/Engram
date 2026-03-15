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
  echo "  --setup-ufw         Configure UFW allow rules for MCP port"
  echo "  --setup-nginx       Install nginx and configure TLS proxy (requires --domain)"
  echo "  --domain NAME       Domain for nginx server_name (required for --setup-nginx)"
  echo "  --ssl-cert PATH     TLS certificate path (default: /etc/ssl/certs/fullchain.pem)"
  echo "  --ssl-key PATH      TLS key path (default: /etc/ssl/private/privkey.pem)"
}

MEMEX_PATH="$MEMEX_PATH_DEFAULT"
SERVICE_USER="memex"
MCP_PORT="3000"
MCP_BIND_ADDR="0.0.0.0"
MCP_API_KEY=""
SETUP_UFW="false"
SETUP_NGINX="false"
NGINX_DOMAIN=""
NGINX_SSL_CERT="/etc/ssl/certs/fullchain.pem"
NGINX_SSL_KEY="/etc/ssl/private/privkey.pem"

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
    --setup-ufw)
      SETUP_UFW="true"
      shift 1
      ;;
    --setup-nginx)
      SETUP_NGINX="true"
      shift 1
      ;;
    --domain)
      NGINX_DOMAIN="$2"
      shift 2
      ;;
    --ssl-cert)
      NGINX_SSL_CERT="$2"
      shift 2
      ;;
    --ssl-key)
      NGINX_SSL_KEY="$2"
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

if [[ "$SETUP_NGINX" == "true" && -z "$NGINX_DOMAIN" ]]; then
  echo "Error: --domain is required when --setup-nginx is used"
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

if [[ "$SETUP_UFW" == "true" ]]; then
  if command -v ufw >/dev/null 2>&1; then
    ufw allow "${MCP_PORT}/tcp"
    ufw reload || true
    echo "UFW rule added for port ${MCP_PORT}"
  else
    echo "UFW not installed; skipping firewall configuration."
  fi
fi

if [[ "$SETUP_NGINX" == "true" ]]; then
  if ! command -v nginx >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update
      apt-get install -y nginx
    elif command -v yum >/dev/null 2>&1; then
      yum install -y nginx
    fi
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    echo "nginx install failed or unavailable. Skipping nginx config."
    exit 1
  fi

  NGINX_SITE_PATH="/etc/nginx/sites-available/memex-mcp"
  cat > "$NGINX_SITE_PATH" <<EOF
server {
  listen 443 ssl;
  server_name ${NGINX_DOMAIN};

  ssl_certificate     ${NGINX_SSL_CERT};
  ssl_certificate_key ${NGINX_SSL_KEY};

  location /mcp {
    proxy_pass http://127.0.0.1:${MCP_PORT}/mcp;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
  }
}
EOF

  if [[ -d /etc/nginx/sites-enabled ]]; then
    ln -sf "$NGINX_SITE_PATH" /etc/nginx/sites-enabled/memex-mcp
  fi

  nginx -t
  systemctl reload nginx
  echo "nginx configured for ${NGINX_DOMAIN}"
fi
