#!/usr/bin/env bash
# One-time server preparation for a fresh Ubuntu 24.04 LTS VPS.
# Run as the default sudo user (OVH: "ubuntu"):   sudo bash bootstrap-server.sh
#
# What it does:
#   - installs updates, firewall, fail2ban, automatic security updates, ffmpeg/espeak-ng (test audio)
#   - SSH: keys only (no passwords), no root login
#   - firewall: only 22 (SSH), 80/443 (web), 2022 (AzuraCast SFTP) are reachable
#   - blocks direct internet access to any Docker-published web/radio port (80, 443, 8000-8999),
#     even though Docker normally bypasses ufw. Everything public goes through Caddy (host network),
#     so AzuraCast - including its first-run setup page - is never directly exposed, even mid-install.
#   - 2 GB swap, UK time zone, /opt/sbradio folders
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi
log() { printf '\n==> %s\n' "$*"; }

# Safety: never lock ourselves out. Require at least one SSH key for the invoking user.
TARGET_USER="${SUDO_USER:-ubuntu}"
if [[ ! -s "/home/${TARGET_USER}/.ssh/authorized_keys" ]]; then
  echo "No SSH key found for ${TARGET_USER}; refusing to disable password login." >&2
  exit 1
fi

log "System updates and packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ufw fail2ban unattended-upgrades curl git jq ffmpeg espeak-ng ca-certificates

log "Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Time zone"
timedatectl set-timezone Europe/London

log "SSH hardening (keys only, no root login)"
cat > /etc/ssh/sshd_config.d/99-sbradio.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sshd -t
systemctl reload ssh || systemctl reload sshd

log "Firewall"
IFACE="$(ip route get 1.1.1.1 | awk '{for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1); exit}')"
echo "Public interface: ${IFACE}"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (certificate checks, redirects to HTTPS)'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 443/udp comment 'HTTPS (HTTP/3)'
ufw allow 2022/tcp comment 'AzuraCast SFTP (large uploads)'

# Docker publishes container ports straight through iptables, bypassing ufw.
# The DOCKER-USER chain is the supported place to filter that traffic.
MARK="# sbradio-docker-user"
if ! grep -q "${MARK}" /etc/ufw/after.rules; then
  cat >> /etc/ufw/after.rules <<EOF

${MARK} BEGIN
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
-A DOCKER-USER -i ${IFACE} -p tcp -m conntrack --ctorigdstport 80 --ctdir ORIGINAL -j DROP
-A DOCKER-USER -i ${IFACE} -p tcp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -j DROP
-A DOCKER-USER -i ${IFACE} -p udp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -j DROP
-A DOCKER-USER -i ${IFACE} -p tcp -m conntrack --ctorigdstport 8000:8999 --ctdir ORIGINAL -j DROP
-A DOCKER-USER -i ${IFACE} -p udp -m conntrack --ctorigdstport 8000:8999 --ctdir ORIGINAL -j DROP
-A DOCKER-USER -j RETURN
COMMIT
${MARK} END
EOF
fi
ufw --force enable
ufw reload
ufw status verbose

log "fail2ban (SSH brute-force protection)"
systemctl enable --now fail2ban

log "Swap (2 GB)"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Folders"
install -d -m 755 -o "${TARGET_USER}" -g "${TARGET_USER}" /opt/sbradio /opt/sbradio/app /opt/sbradio/config /opt/sbradio/generated /opt/sbradio/test-audio /opt/sbradio/logs
install -d -m 700 -o "${TARGET_USER}" -g "${TARGET_USER}" /opt/sbradio/secrets

log "Done. Next: install-azuracast.sh"
