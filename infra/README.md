# /infra: Server Setup

How the server is put together:

```
Internet ──443──► Caddy (HTTPS, Let's Encrypt; host network)
                   ├─ radio.<domain>  → AzuraCast        127.0.0.1:8080  (admin, public API, /listen streams, /hls)
                   ├─ api.<domain>    → Registry API     127.0.0.1:3000
                   └─ player.<domain> → test player      static files
AzuraCast (Docker, /var/azuracast) - its ports are blocked from the internet by the firewall
```

| File | Purpose |
|---|---|
| `scripts/bootstrap-server.sh` | One-time OS hardening: updates, ufw + Docker port blocking, keys-only SSH, fail2ban, swap |
| `scripts/install-azuracast.sh` | Installs AzuraCast (stable channel) and moves it to port 8080 |
| `compose.yml`, `Caddyfile` | Caddy + registry API + test player |
| `scripts/up.sh` | (Re)starts Caddy/registry; writes the player's `config.js` |
| `scripts/deploy.sh` | From the dev PC: copies code to the server and runs `up.sh` |
| `scripts/generate-test-audio.sh` | Synthetic, licence-free test mixes with spoken minute markers |
| `stations.poc.json` | Stage 2 station definitions |
| `scripts/provision-stations.mjs` | Creates/updates stations, uploads media, playlists, fallback file, via the AzuraCast admin API (server-side key) |
| `scripts/check-continuous.mjs` | Proves stations advance with no listeners (public API only) |
| `.env.example` | Domains, certificate email, CORS origins. Lives on the server at `/opt/sbradio/config/sbradio.env` |

**Server paths:**

| Path | Contents |
|---|---|
| `/opt/sbradio/app` | Deployed code |
| `/opt/sbradio/config/sbradio.env` | Settings (not secret) |
| `/opt/sbradio/secrets/azuracast-api.env` | AzuraCast API key (mode 600, server-only, never in git) |
| `/opt/sbradio/test-audio` | Generated test media |
| `/var/azuracast` | AzuraCast install |

The full first-time runbook is in [docs/stage2-poc.md](../docs/stage2-poc.md). Ordering the VPS is covered in [docs/stage2-vps-setup.md](../docs/stage2-vps-setup.md).
