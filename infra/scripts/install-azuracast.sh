#!/usr/bin/env bash
# Installs AzuraCast (Docker, STABLE release channel) and moves its web server to internal
# ports so a front proxy (Caddy on the VPS, the Windows gateway locally) owns public access.
#   sudo bash install-azuracast.sh
#
# Env (defaults = production VPS):
#   AZURACAST_DIR=/var/azuracast   install folder (local WSL: /root/azuracast)
#   AZ_HTTP_PORT=8080 AZ_HTTPS_PORT=8443   internal ports (local WSL: 18080 / 18443)
#
# Official instructions: https://www.azuracast.com/docs/getting-started/installation/docker/
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Run with sudo (or as root)." >&2; exit 1; fi
log() { printf '\n==> %s\n' "$*"; }

AZURACAST_DIR="${AZURACAST_DIR:-/var/azuracast}"
AZ_HTTP_PORT="${AZ_HTTP_PORT:-8080}"
AZ_HTTPS_PORT="${AZ_HTTPS_PORT:-8443}"

mkdir -p "$AZURACAST_DIR"
cd "$AZURACAST_DIR"

if [[ ! -x docker.sh ]]; then
  log "Downloading AzuraCast docker.sh"
  curl -fsSL https://raw.githubusercontent.com/AzuraCast/AzuraCast/main/docker.sh -o docker.sh
  chmod a+x docker.sh
fi

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^azuracast$'; then
  log "Selecting the STABLE release channel"
  yes 'Y' | ./docker.sh setup-release || true

  log "Installing AzuraCast in $AZURACAST_DIR (unattended, defaults). This takes several minutes."
  yes '' | ./docker.sh install
fi

set_env() { # set_env KEY VALUE  -> in $AZURACAST_DIR/.env
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

log "Moving AzuraCast to internal ports ${AZ_HTTP_PORT} (HTTP) / ${AZ_HTTPS_PORT} (HTTPS)"
set_env AZURACAST_HTTP_PORT "$AZ_HTTP_PORT"
set_env AZURACAST_HTTPS_PORT "$AZ_HTTPS_PORT"
docker compose down
docker compose up -d

log "Waiting for AzuraCast to answer on 127.0.0.1:${AZ_HTTP_PORT}"
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${AZ_HTTP_PORT}/api/status"; then break; fi
  sleep 5
done
curl -fsS "http://127.0.0.1:${AZ_HTTP_PORT}/api/status" && echo

grep -E '^AZURACAST_(VERSION|HTTP_PORT|HTTPS_PORT)=' .env || true
echo "Check the exact version on the System Administration page: it must be 0.23.6 or later."

log "Done."
