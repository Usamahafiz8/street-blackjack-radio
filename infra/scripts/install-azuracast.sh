#!/usr/bin/env bash
# Installs AzuraCast (Docker, STABLE release channel) and moves it to internal ports
# 8080/8443 so Caddy can own 80/443.   Run: sudo bash install-azuracast.sh
#
# Official instructions: https://www.azuracast.com/docs/getting-started/installation/docker/
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi
log() { printf '\n==> %s\n' "$*"; }

mkdir -p /var/azuracast
cd /var/azuracast

if [[ ! -x docker.sh ]]; then
  log "Downloading AzuraCast docker.sh"
  curl -fsSL https://raw.githubusercontent.com/AzuraCast/AzuraCast/main/docker.sh -o docker.sh
  chmod a+x docker.sh
fi

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^azuracast$'; then
  log "Selecting the STABLE release channel"
  yes 'Y' | ./docker.sh setup-release || true

  log "Installing AzuraCast (unattended, defaults). This takes several minutes."
  yes '' | ./docker.sh install
fi

set_env() { # set_env KEY VALUE  -> in /var/azuracast/.env
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

log "Moving AzuraCast to internal ports 8080 (HTTP) / 8443 (HTTPS)"
set_env AZURACAST_HTTP_PORT 8080
set_env AZURACAST_HTTPS_PORT 8443
docker compose down
docker compose up -d

log "Waiting for AzuraCast to answer on 127.0.0.1:8080"
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:8080/api/status; then break; fi
  sleep 5
done
curl -fsS http://127.0.0.1:8080/api/status && echo

VERSION="$(docker exec azuracast sh -c 'cat /var/azuracast/www/src/Version.php 2>/dev/null' | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" | head -1 || true)"
echo "AzuraCast version: ${VERSION:-unknown (check System Administration page)}"
echo "Must be 0.23.6 or later (security fix for reverse-proxy headers)."

log "Done. Next: deploy Caddy + registry (up.sh), then the admin creates the first account via the SSH tunnel."
