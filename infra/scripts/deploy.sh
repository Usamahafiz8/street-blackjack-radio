#!/usr/bin/env bash
# Copies the repo's infra/, registry-api/ and player/ to the server and restarts the
# Caddy + registry services. Run from Git Bash on the development PC:
#
#   infra/scripts/deploy.sh ubuntu@<server-ip>
#
# Uses the SSH key in $SSH_KEY (default ~/.ssh/sbradio_ed25519). Secrets are never copied.
set -euo pipefail
HOST="${1:?usage: deploy.sh user@server}"
KEY="${SSH_KEY:-$HOME/.ssh/sbradio_ed25519}"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST")

cd "$(dirname "$0")/../.."
echo "==> Uploading code to $HOST:/opt/sbradio/app"
tar --exclude='.git' --exclude='node_modules' --exclude='.env' --exclude='.env.*' --exclude='*.mp3' --exclude='*.wav' \
  -czf - infra registry-api player | "${SSH[@]}" 'mkdir -p /opt/sbradio/app && tar -xzf - -C /opt/sbradio/app'

echo "==> Restarting services"
"${SSH[@]}" 'cd /opt/sbradio/app/infra && sudo bash scripts/up.sh'
