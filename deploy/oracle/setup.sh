#!/usr/bin/env bash
# Sets up (or updates) the game on an Oracle Cloud Ubuntu VM. Safe to run again.
#
#   bash deploy/oracle/setup.sh your-name.duckdns.org you@example.com
#
# Installs Node.js 22 and Caddy (which gets the HTTPS certificate), opens ports 80 and 443 in the
# VM's own firewall, builds the game and runs it as a service that restarts after a crash or reboot.
# See README-HOSTING.md for the steps in the Oracle console that have to come first.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ || ! "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]]; then
  echo "Usage: bash deploy/oracle/setup.sh your-name.duckdns.org you@example.com" >&2
  exit 1
fi
if [[ "$(id -u)" == 0 ]]; then
  echo "Run this as your normal user (ubuntu), not root. It uses sudo where it needs to." >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_USER="$(id -un)"
PORT=3001

echo "==> Swap (1 GB shapes run out of memory during the build)"
MEM_MB="$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)"
if (( MEM_MB < 2000 )) && [[ ! -e /swapfile ]]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Packages"
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
command -v caddy >/dev/null || { sudo apt-get update; sudo apt-get install -y caddy; }

echo "==> VM firewall (Oracle's Ubuntu images block everything except SSH)"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
command -v netfilter-persistent >/dev/null \
  || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
sudo netfilter-persistent save

echo "==> Game build"
if [[ ! -f "$APP_DIR/server/.env" ]]; then
  cat > "$APP_DIR/server/.env" <<ENV
# Only Caddy talks to the game directly
HOST=127.0.0.1
PORT=$PORT
VAPID_SUBJECT=mailto:$EMAIL
ENV
fi
cd "$APP_DIR"
# Dev dependencies stay: the server runs through tsx, and the client build needs Vite
npm ci
npm run build

echo "==> Game service"
sudo tee /etc/systemd/system/xiangqi.service >/dev/null <<UNIT
[Unit]
Description=Xiangqi game server
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/server
ExecStart=$(command -v node) --import tsx src/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable xiangqi
sudo systemctl restart xiangqi

echo "==> HTTPS"
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
{
	email $EMAIL
}

$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
CADDY
sudo systemctl enable caddy
sudo systemctl restart caddy

echo "==> Checking https://$DOMAIN (the first certificate can take a minute)"
for _ in {1..30}; do
  if curl -fsS "https://$DOMAIN/health"; then
    echo
    echo "Ready: https://$DOMAIN"
    exit 0
  fi
  sleep 5
done
echo "No answer from https://$DOMAIN yet. Troubleshooting is in README-HOSTING.md." >&2
exit 1
