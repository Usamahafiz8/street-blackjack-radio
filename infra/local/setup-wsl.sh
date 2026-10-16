#!/usr/bin/env bash
# LOCAL DEVELOPMENT ONLY - prepares the WSL2 Ubuntu-24.04 distro.
# This is the local equivalent of scripts/bootstrap-server.sh. There is no firewall, SSH or
# swap work here: Windows only forwards WSL ports to localhost, so nothing in WSL is reachable
# from the network. Run from Windows:
#   wsl -d Ubuntu-24.04 -u root -- bash /mnt/d/radio/infra/local/setup-wsl.sh
set -euo pipefail
log() { printf '\n==> %s\n' "$*"; }

log "Packages (curl, git, jq, ffmpeg, espeak-ng)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git jq ffmpeg espeak-ng nodejs ca-certificates

log "Time zone"
timedatectl set-timezone Europe/London 2>/dev/null || ln -sf /usr/share/zoneinfo/Europe/London /etc/localtime

log "Folders"
install -d -m 755 /opt/sbradio /opt/sbradio/config /opt/sbradio/generated /opt/sbradio/test-audio /opt/sbradio/logs
install -d -m 700 /opt/sbradio/secrets

bash "$(dirname "$0")/fix-wsl-clock.sh"

log "Done. Next: AZURACAST_DIR=/root/azuracast AZ_HTTP_PORT=18080 AZ_HTTPS_PORT=18443 bash install-azuracast.sh"
