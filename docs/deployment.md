# Street Blackjack Radio: Production Deployment

How to put the radio on a real server with HTTPS, then keep it backed up and updated. Every step here has already been run on the local test setup. Commands are copy-paste.

```
Internet ──443──► Caddy (automatic HTTPS)
                   ├─ radio.<domain>   → AzuraCast (dashboard, public now-playing, /listen and /hls streams)
                   ├─ api.<domain>     → Station Registry API (the game uses this)
                   └─ player.<domain>  → test player (optional)
AzuraCast's own ports are blocked by the firewall. Only Caddy faces the internet.
```

## 1. Before you start

| Need | Detail |
|---|---|
| Server | **OVHcloud VPS-4** (8 vCores, 24 GB RAM, 200 GB NVMe, unlimited traffic), UK, Ubuntu 24.04. Ordering steps: [stage2-vps-setup.md](stage2-vps-setup.md). |
| Domain | Three DNS **A records** pointing at the server IP: `radio.<domain>`, `api.radio.<domain>`, `player.radio.<domain>`. Create them first and wait until `nslookup radio.<domain>` shows the IP. |
| SSH key | `sbradio_ed25519` (see stage2-vps-setup.md). No passwords anywhere. |
| Email | For HTTPS certificate notices |
| Content | Real mixes (split into parts, see admin guide §3), adverts, station logos |

## 2. First-time setup (about 1 hour)

From the development PC (Git Bash), in `D:\radio`:

```bash
HOST=ubuntu@SERVER_IP
KEY=~/.ssh/sbradio_ed25519

# 2.1 Harden the server: firewall + Docker port blocking, keys-only SSH, fail2ban, auto security updates
scp -i $KEY infra/scripts/bootstrap-server.sh infra/scripts/install-azuracast.sh $HOST:~/
ssh -i $KEY $HOST 'sudo bash ~/bootstrap-server.sh'

# 2.2 Install AzuraCast (stable channel), moved to internal port 8080
ssh -i $KEY $HOST 'sudo bash ~/install-azuracast.sh'
```

**2.3 Server settings:** create `/opt/sbradio/config/sbradio.env` on the server (`ssh -i $KEY $HOST`, then `nano /opt/sbradio/config/sbradio.env`):

```bash
RADIO_DOMAIN=radio.example.com
API_DOMAIN=api.radio.example.com
PLAYER_DOMAIN=player.radio.example.com
ACME_EMAIL=you@example.com
# The game's web origin(s), plus the test player:
CORS_ORIGINS=https://play.streetblackjack.com,https://player.radio.example.com
# Optional: only these IPs can open the admin dashboard (listeners are unaffected). Leave out to allow all.
# ADMIN_ALLOW_IPS=203.0.113.7 198.51.100.0/24
```

**Steps 2.4 to 2.7:**

```bash
# 2.4 Caddy (HTTPS), registry API and test player
infra/scripts/deploy.sh $HOST
```

2.5 **Create the admin account yourself** through the SSH tunnel: steps 5–6 of [stage2-vps-setup.md](stage2-vps-setup.md). The setup page is blocked from the internet until then. Turn on two-factor login straight away.

2.6 **Production station list:** edit `registry-api/config/stations.config.json`.
- **Delete** the `external-test` and `offline-test` entries.
- For OnTop FM: set its HTTPS `stream_url` and `"enabled": true`.

Then run `infra/scripts/deploy.sh $HOST` again.

2.7 **Stations:** create the five stations either way:
- **in the dashboard**, following [admin-guide.md](admin-guide.md) §8; or
- **with the setup script.** Copy your media to the server in the same folder layout as `infra/stations.full.json` (one folder per station, plus `ads/`). Set `play_per_songs` to **2** for real ~30-minute parts and remove the test schedule dates. Then run:

  ```bash
  ssh -i $KEY $HOST 'sudo docker run --rm --network host \
    --env-file /opt/sbradio/secrets/azuracast-api.env --env-file /opt/sbradio/config/sbradio.env \
    -v /opt/sbradio/app/infra:/infra:ro -v /opt/sbradio/media:/media:ro \
    node:22-alpine node /infra/scripts/provision-stations.mjs /infra/stations.full.json /media'
  ```

  It's safe to run again; it skips anything already done.

## 3. HTTPS / SSL

- **Caddy gets and renews Let's Encrypt certificates automatically** for the three domains. There's nothing to renew by hand.
- Requirements: ports 80 and 443 open (the bootstrap script does this), and DNS pointing at the server *before* `deploy.sh`.
- Check: `curl -I https://api.radio.<domain>/health` → `HTTP/2 200`.
- Streams and API are **HTTPS only**. Plain `http://` redirects to `https://`, so pages and the game never get mixed-content errors.

## 4. Acceptance tests on the server (30–60 min, nobody listening)

The same tests that passed locally (see [testing.md](testing.md)):

```bash
# from any PC with Node 18+
node infra/scripts/check-continuous.mjs --base https://radio.<domain> --minutes 40 --out docs/results/prod-continuous.json
node infra/scripts/check-ads.mjs        --base https://radio.<domain> --minutes 30 --out docs/results/prod-ads.json
# on the server: 300 listeners for 60 s (also proves the stream rate is real-time)
ssh -i $KEY $HOST 'node /opt/sbradio/app/tools/load-test/load-test.mjs --base http://127.0.0.1:8080 --listeners 300 --seconds 60'
```

Then run the device checklist in [testing.md](testing.md) on real iPhones and Android phones against `https://player.radio.<domain>`.

## 5. Backups

| What | How | When |
|---|---|---|
| Database and settings (stations, playlists, schedules, users, history) | Dashboard → *Administration → Backups* → **Automatic Backups**: daily, keep 14, **Exclude media** ticked | Daily |
| Off-site copy of those backups | `rclone` to S3-compatible storage (Cloudflare R2 / Backblaze B2). Example below. | Daily (cron) |
| Media (mixes, adverts) | Keep originals off-server (cloud drive or bucket). Optional `rclone sync` of station media. | After uploads |
| Server snapshot | OVH automatic daily backup (included) | Daily |
| Code and configuration | This git repository (push it to GitHub/GitLab) | Every change |

Off-site copy (on the server, after `rclone config` creates a remote called `offsite`):

```bash
sudo crontab -e
# 03:30 daily: copy AzuraCast backups off the server
30 3 * * * docker cp azuracast:/var/azuracast/backups /tmp/azb && rclone copy /tmp/azb offsite:sbradio-backups/$(hostname) && rm -rf /tmp/azb
```

A manual backup was tested locally: `azuracast:backup … --exclude-media` finished in 0.66 s and produced a 26 KB file containing the full database.

### Restore (target: back on air in 1–2 hours)
1. New VPS → sections 2.1–2.4.
2. Copy the latest backup to the server, then:

   ```bash
   cd /var/azuracast && sudo ./docker.sh restore /path/to/backup.zip
   ```

3. Copy media back into each station (`rclone copy`, or upload again).
4. Point DNS at the new IP if it changed. Keep the DNS TTL at 300 s so this is quick.
5. Run the acceptance tests (section 4).

**Do a restore drill once after go-live**, on a spare VPS, so you know the steps work.

## 6. Updates

| What | How | How often |
|---|---|---|
| Ubuntu security updates | Automatic (unattended-upgrades) | Automatic |
| AzuraCast | `ssh -i $KEY $HOST 'cd /var/azuracast && sudo ./docker.sh update'`. Stable channel. Back up first; do it in a quiet hour (stations restart and listeners reconnect by themselves). | Monthly, or when a security release appears |
| Registry API / player | Commit changes, then `infra/scripts/deploy.sh $HOST` | When changed |
| Caddy | Bump the image tag in `infra/compose.yml`, then `deploy.sh` | Every few months |

After any update: check `https://api.radio.<domain>/health` and play one station.

## 7. Monitoring

Use a free uptime monitor (UptimeRobot, Better Stack or similar), every 1–5 minutes:
- `https://api.radio.<domain>/health`: expect `"reachable":true`
- One stream per station: `https://radio.<domain>/listen/<station>/radio.mp3`, expect HTTP 200 with `audio/mpeg`

Set it to alert you by email or phone. The AzuraCast dashboard (*Administration → System*) shows CPU, memory and disk.

## 8. Capacity and scaling

Locally, **1,000 simultaneous listeners got full-quality audio with no drops**, using under 2 CPU cores (see testing.md).

On the VPS the limits are:
- **network:** 128 kbps × listeners, e.g. 1,000 = 128 Mbit/s; VPS-4 has a 3 Gbit/s port;
- **fair use** of the shared vCPUs.

Beyond about 2,000 listeners, add an **AzuraRelay** server (about £6/month) and hand out relay URLs from the registry. The game doesn't change.

## 9. Moving from the local test PC to the server

See the table "What changes when we move to the real server" in [stage2-local.md](stage2-local.md). In short:
- Caddy and real domains replace the Windows gateway and tunnels.
- Fixed HTTPS addresses replace `AZURACAST_PUBLIC_URL=auto`.
- CORS becomes an allow-list.
- The owner creates the admin account (not a script).

Rebuild the Vercel test player with `API_BASE=https://api.radio.<domain>` if you keep using it ([vercel.md](vercel.md)).
