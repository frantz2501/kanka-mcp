#!/usr/bin/env bash
# kanka-mcp installer - Ubuntu 24.04 (works on any Debian-ish with systemd)
# Usage: sudo bash install.sh
set -euo pipefail

APP_NAME="kanka-mcp"
INSTALL_DIR="/opt/kanka-mcp"
ENV_FILE="/etc/kanka-mcp.env"
SERVICE_FILE="/etc/systemd/system/kanka-mcp.service"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run with sudo"; exit 1; }

# 1. Node >= 18
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Installing Node 22 LTS via NodeSource..."
  apt-get update && apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { echo "ERROR: Node >= 18 required (found $(node -v))"; exit 1; }

# 2. Files
mkdir -p "$INSTALL_DIR"
cp -r "$SRC_DIR"/server.js "$SRC_DIR"/README.md "$SRC_DIR"/DEPLOY.md "$INSTALL_DIR"/ 2>/dev/null || cp "$SRC_DIR/server.js" "$INSTALL_DIR/"
chmod 644 "$INSTALL_DIR/server.js"

# 3. Env file (never overwrite an existing one)
if [ ! -f "$ENV_FILE" ]; then
  KANKA_TOKEN_PROMPT="${KANKA_API_TOKEN:-}"
  HTTP_TOKEN_PROMPT="$(head -c 32 /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 40)"
  cat > "$ENV_FILE" <<ENVEOF
# kanka-mcp environment - edit then: systemctl restart kanka-mcp
KANKA_API_TOKEN=${KANKA_TOKEN_PROMPT}
KANKA_DEFAULT_CAMPAIGN=
KANKA_API_BASE=https://api.kanka.io/1.0
# HTTP transport
KANKA_MCP_BIND=127.0.0.1
KANKA_MCP_PORT=3333
# Bearer token required by HTTP clients (generated randomly by the installer)
KANKA_MCP_HTTP_TOKEN=${HTTP_TOKEN_PROMPT}
ENVEOF
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE with a random HTTP token."
else
  echo "Keeping existing $ENV_FILE"
fi

# 4. systemd unit
cat > "$SERVICE_FILE" <<SVCEOF
[Unit]
Description=kanka-mcp - MCP server for the Kanka.io API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env node $INSTALL_DIR/server.js --http
Restart=always
RestartSec=5
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR

[Install]
WantedBy=multi-user.target
SVCEOF

# 5. Start
systemctl daemon-reload
systemctl enable --now kanka-mcp
sleep 2
systemctl --no-pager --lines=5 status kanka-mcp || true

PORT="$(grep -oP 'KANKA_MCP_PORT=\K\d+' "$ENV_FILE" || echo 3333)"
echo
echo "=== kanka-mcp installed ==="
echo "Health check : curl http://127.0.0.1:${PORT}/"
echo "Config file  : $ENV_FILE (chmod 600)"
echo "HTTP token   : grep KANKA_MCP_HTTP_TOKEN $ENV_FILE"
echo "Logs         : journalctl -u kanka-mcp -f"
echo
echo "If you expose this server remotely, set KANKA_MCP_BIND=0.0.0.0 AND"
echo "use a reverse proxy with TLS, or keep 127.0.0.1 and use an SSH tunnel."
