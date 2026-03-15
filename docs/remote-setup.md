# Remote MCP Setup (Streamable HTTP)

Memex supports remote MCP access via Streamable HTTP. This is the recommended transport for networked agents. SSE-only is deprecated.

## 1. Start the server

```bash
# Bind to localhost (default)
MCP_API_KEY="replace-me" node scripts/mcp-server-http.mjs

# Bind to a LAN IP for internal use
MCP_API_KEY="replace-me" MCP_BIND_ADDR=192.168.1.10 MCP_PORT=3000 node scripts/mcp-server-http.mjs

# Bind to all interfaces (use with firewall or reverse proxy)
MCP_API_KEY="replace-me" MCP_BIND_ADDR=0.0.0.0 MCP_PORT=3000 node scripts/mcp-server-http.mjs
```

## 2. Connect a client

Claude Desktop or any MCP client can connect with a simple URL:

```json
{
  "mcpServers": {
    "memex": {
      "url": "https://memex.yourdomain.com/mcp"
    }
  }
}
```

Auth options supported by the server:

- `Authorization: Bearer <MCP_API_KEY>`
- `X-API-Key: <MCP_API_KEY>`

## 2.5 Test from another machine

From a different machine on the same network:

```bash
curl -i \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MCP_API_KEY>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://<server-ip>:3000/mcp
```

You should get a JSON-RPC response listing tools. If you get:
- `401` → missing API key
- `403` → wrong API key
- connection refused → firewall or bind address issue

## 3. Reverse proxy (recommended for TLS)

Example nginx config:

```nginx
server {
  listen 443 ssl;
  server_name memex.yourdomain.com;

  ssl_certificate     /etc/ssl/certs/fullchain.pem;
  ssl_certificate_key /etc/ssl/private/privkey.pem;

  location /mcp {
    proxy_pass http://127.0.0.1:3000/mcp;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
  }
}
```

## 4. LAN-only mode

If you only want access inside your local network:

- Bind to a private interface (example: `192.168.1.10`)
- Do not expose the port publicly
- Optionally configure a firewall allowlist for your LAN subnet

## 5. Run as a systemd service (Linux)

Create a dedicated user:
```bash
sudo useradd -r -s /bin/false memex
```

Install Memex to `/opt/memex` (or your preferred path) and set ownership:
```bash
sudo mkdir -p /opt/memex
sudo chown -R memex:memex /opt/memex
```

Create `/etc/systemd/system/memex-mcp.service`:
```ini
[Unit]
Description=Memex MCP HTTP Server
After=network.target

[Service]
Type=simple
User=memex
Group=memex
WorkingDirectory=/opt/memex
Environment=NODE_ENV=production
Environment=MEMEX_PATH=/opt/memex
Environment=MCP_API_KEY=replace-me
Environment=MCP_BIND_ADDR=0.0.0.0
Environment=MCP_PORT=3000
ExecStart=/usr/bin/node /opt/memex/scripts/mcp-server-http.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/memex

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable memex-mcp
sudo systemctl start memex-mcp
sudo systemctl status memex-mcp
```

Firewall (example for UFW):
```bash
sudo ufw allow 3000/tcp
```

## Troubleshooting

- `401 Unauthorized`: missing `MCP_API_KEY`
- `403 Forbidden`: invalid API key
- Connection hangs: ensure proxy buffering is disabled for `/mcp`
