#!/usr/bin/env bash
# LOCAL DEVELOPMENT ONLY - fixes the WSL2 clock *rate* on PCs where it runs slow.
#
# Problem found in Stage 2: on this PC the WSL2 VM's monotonic clock ran at ~0.965x real time.
# WSL keeps the date right by jumping it forward, but Liquidsoap paces audio on the monotonic
# clock, so stations produced only ~97% of real-time audio (124 kbps instead of 128 kbps),
# which makes listeners re-buffer every few minutes.
#
# Fix: chrony disciplines the kernel clock frequency (including the large-correction "tick"
# setting), using the Hyper-V host clock (/dev/ptp_hyperv) as the reference. Affects only the
# WSL VM. Not needed on a real server. Undo: apt-get remove -y chrony
#   wsl -d Ubuntu-24.04 -u root -- bash /mnt/d/radio/infra/local/fix-wsl-clock.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get install -y chrony

cat > /etc/chrony/conf.d/wsl-hyperv.conf <<'EOF'
# Street Blackjack Radio (local WSL): use the Hyper-V host clock as reference
refclock PHC /dev/ptp_hyperv poll 2 dpoll -2 offset 0 stratum 2
# allow large frequency corrections (WSL clock can be several % off) and step big offsets
maxdrift 100000
makestep 1.0 -1
EOF
# Don't rely on internet NTP for this; the host clock is the reference.
sed -i 's/^\(pool .*\)$/# \1/' /etc/chrony/chrony.conf

systemctl enable chrony >/dev/null 2>&1 || true
systemctl restart chrony
sleep 20
chronyc tracking
chronyc sources
