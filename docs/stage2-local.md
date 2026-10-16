# Stage 2 on This PC (WSL2): Setup and Testing Guide

Stage 2 runs on this Windows PC instead of a VPS. Everything listeners need is the same software as production; only the "front door" differs (see the last section).

## What is running

```
 Your phone / browser
        │
        ▼
 Gateway (Windows, node, port 8088)  ── the ONLY thing reachable from Wi-Fi or the tunnel
   ├── /                → test player (D:\radio\player)
   ├── /v1/*, /art/*    → Registry API (WSL Docker, localhost:3000)
   └── /listen/*, /hls/*→ AzuraCast audio streams (WSL, localhost:18080)
        everything else (dashboard, login, admin API, setup) → 404

 AzuraCast admin: http://localhost:18080 ── only from this PC (Windows forwards WSL ports to 127.0.0.1 only)

 Optional: Cloudflare quick tunnel ──► gateway :8088   (temporary https://….trycloudflare.com)
```

| Part | Where |
|---|---|
| WSL distro | `Ubuntu-24.04` (24.04.5 LTS), runs as root inside WSL, no Linux password needed |
| AzuraCast (stable channel) | `/root/azuracast` inside the distro (Linux filesystem); web on port 18080 |
| Test audio | `/opt/sbradio/test-audio` inside the distro (synthetic, licence-free) |
| Registry API | Docker container `sbradio-local-registry-1`; reads `D:\radio\registry-api\config` live |
| Gateway | `D:\radio\infra\local\gateway.mjs` (Windows Node) |
| Start / stop everything | `infra\local\start-local.ps1` / `infra\local\stop-local.ps1` |

> **Your previous AzuraCast** (in the WSL distro called `Ubuntu`, 26.04) was **stopped, not deleted**. Its 5 stations and media are intact. It can't run at the same time as this one, because WSL distros share the same network ports and Docker networking. To switch back later, stop this stack (`stop-local.ps1 -All`), then run:
>
> ```powershell
> wsl -d Ubuntu -u root -- bash -c "systemctl start docker && cd /var/azuracast && docker compose up -d"
> ```
>
> Also avoid opening the old `Ubuntu` distro while testing. Its Docker service starts automatically and can disturb this one's networking. Note that `wsl` on its own opens `Ubuntu`, because it's still your default distro.

---

## Admin login (local test install)

At your request, I created the local admin account and API key with `infra/local/bootstrap-admin.mjs`. Both use randomly generated **test** credentials. They're stored only inside WSL, in files readable only by root, and were never shown in chat or committed to git.

| File (inside `Ubuntu-24.04`) | Contents |
|---|---|
| `/opt/sbradio/secrets/azuracast-admin.env` | Admin email `admin@sbradio.test` and password |
| `/opt/sbradio/secrets/azuracast-api.env` | API key used by the station setup script |

To log in at **http://localhost:18080**, show the password in **your own** PowerShell window:

```powershell
wsl -d Ubuntu-24.04 -u root -- cat /opt/sbradio/secrets/azuracast-admin.env
```

You can change the password under *My Account* after logging in. If you ever lock yourself out:

```powershell
wsl -d Ubuntu-24.04 -u root -- docker exec -it azuracast azuracast_cli azuracast:account:reset-password admin@sbradio.test
```

This shortcut is **local only**. On the real server you create the admin account yourself through the SSH tunnel (see `stage2-vps-setup.md`).

## Your steps

### 1. Stop the PC sleeping while the radio runs
The test runs for about 40 minutes, and the radio should keep running while you test from your phone.
- **Settings → System → Power & sleep → Sleep → "When plugged in, PC goes to sleep after": Never.** The screen turning off is fine; only *sleep* stops the radio.
- **If this is a laptop:** Control Panel → Power Options → *Choose what closing the lid does* → **When plugged in: Do nothing**. Keep it plugged in.
- Or the same thing from PowerShell:

  ```powershell
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  ```

  Put them back afterwards, e.g. 30 minutes: `powercfg /change standby-timeout-ac 30`.
- I'll also ask the Claude app to keep the PC awake while the test runs.

### 2. Phone testing: pick one or both

**A. Temporary HTTPS tunnel (recommended for iPhone).** It works on Wi-Fi *or* mobile data, and needs no firewall change. HTTPS is required for lock-screen controls, Add to Home Screen (PWA) and background-playback tests.

Start (or restart) the stack with a tunnel:

```powershell
powershell -ExecutionPolicy Bypass -File D:\radio\infra\local\start-local.ps1 -Tunnel
```

It prints an `https://…` address. Open that on your iPhone.
- The script tries a **Cloudflare quick tunnel** first.
  - On this connection Cloudflare's tunnel service answers too slowly: about 6 s over IPv4, and IPv6 doesn't work. `cloudflared` gives up every time.
  - So the script **falls back to localhost.run**: a free, account-free HTTPS tunnel using the SSH client built into Windows. Its addresses look like `https://abc123.lhr.life`.
- Either way, the tunnel forwards **only the gateway** (port 8088): the player, the station list, the audio and album art. I checked that the dashboard, login, setup and AzuraCast API return 404 through the tunnel.
- The address changes each time, and free localhost.run addresses can expire after a while. Just run the script again with `-Tunnel`.
- `stop-local.ps1` closes the tunnel.
- These free tunnels are for testing only; production uses a real domain with HTTPS.

**B. Same Wi-Fi, plain HTTP.** Fine for basic play, switching and the leave-and-return test. No PWA or lock-screen controls.
1. Windows currently treats your Wi-Fi ("Home-4G") as a **Public** network, which blocks incoming connections. Either:
   - change it to Private: **Settings → Network & Internet → Wi-Fi → Home-4G → Network profile: Private**;

     and/or
   - in an **administrator** PowerShell, allow only the gateway port on private networks:

     ```powershell
     New-NetFirewallRule -DisplayName "SBR gateway 8088 (temporary)" -Direction Inbound -Protocol TCP -LocalPort 8088 -Profile Private -Action Allow
     ```

2. On the phone, open **http://192.168.100.10:8088**. That address can change if your router gives the PC a new one; `start-local.ps1` prints the current one.
3. Remove the rule when done:

   ```powershell
   Remove-NetFirewallRule -DisplayName "SBR gateway 8088 (temporary)"
   ```

---

## WSL2 clock problem (found and fixed)

The first 40-minute run **failed**, and it was right to:
- On this PC, WSL2's internal clock ran at **0.965× real time**.
- Liquidsoap (AzuraCast's playout engine) paces audio on that clock. So each 12:00 mix took about 12:30 of real time.
- The streams delivered **124 kbps instead of 128 kbps**. That's 3% too little audio, which makes listeners re-buffer every few minutes.
- WSL hides this by occasionally jumping the date forward, so the time *looks* correct.

**Fix:** `infra/local/fix-wsl-clock.sh` installs **chrony**, which corrects the clock *rate* using the Hyper-V host clock as its reference.
- After the fix the clock runs at **1.0000×** and the stream at **127.9 kbps (0.999× real time)**.
- It only affects the WSL VM and stays on after restarts.
- Undo with: `wsl -d Ubuntu-24.04 -u root -- apt-get remove -y chrony`.
- `setup-wsl.sh` now applies it automatically.
- A real Linux server keeps proper time with NTP, so this is **not** a production issue. Still, Stage 4 will include the same stream-rate check on the server.

Run 1 is kept in `docs/results/stage2-continuous-run1-wsl-clock-drift.*`.

---

## Tests (after I've created the stations)
These are the same tests as [stage2-poc.md](stage2-poc.md#how-you-can-check-it-yourself). Use **http://localhost:8088** on this PC, or the tunnel address on your phone.

1. **Leave and return:**
   - Play UK Rap and note the spoken minute ("…Minute 3").
   - Pause or close the app, wait 5 minutes, then play again.
   - You hear "…Minute 8", not minute 3.
2. **Switching:** UK Rap ↔ Afrobeats. Each one is at its own live position.
3. **External / offline:** the SomaFM test station plays; "Offline Test Station" is greyed out.
4. **Restart recovery:**
   - In the AzuraCast dashboard (localhost:18080) → UK Rap → **Restart Broadcasting** while you listen.
   - The player reconnects by itself.
5. **iPhone (tunnel):**
   - Lock-screen controls.
   - Play, lock the phone, unlock.
   - Add to Home Screen → open it → play → switch apps → come back.

---

## What changes when we move to the real server

| Local (now) | Production VPS |
|---|---|
| WSL distro `Ubuntu-24.04`, root user | Ubuntu 24.04 VPS, `ubuntu` user with sudo |
| AzuraCast in `/root/azuracast`, port 18080 (8080 was taken on this PC) | `/var/azuracast`, port 8080 (`install-azuracast.sh` defaults) |
| `infra/local/setup-wsl.sh` (packages only) | `infra/scripts/bootstrap-server.sh` (firewall + Docker port blocking, keys-only SSH, fail2ban, swap) |
| Windows Node **gateway** on :8088, HTTP | **Caddy** on 443 with Let's Encrypt (`infra/Caddyfile`), real HTTPS domains |
| Admin protected by "localhost only" | Admin on `https://radio.<domain>`, normal login + 2FA; `/setup` blocked except via SSH tunnel |
| Registry `AZURACAST_PUBLIC_URL=auto` (URLs follow the request) | Fixed `https://radio.<domain>` (`infra/compose.yml`) |
| `CORS_ORIGINS=*` | Allow-list: player domain + the game's domain(s) |
| AzuraCast base URL `http://localhost:18080`, set with `BASE_URL=` | `https://radio.<domain>`, from `RADIO_DOMAIN` |
| Temporary tunnel (Cloudflare / localhost.run) for phone HTTPS | Not needed: the real domain has HTTPS |
| Admin + API key created by `bootstrap-admin.mjs` with generated test credentials | Owner creates the admin via SSH tunnel; API key saved by the owner |
| Keep-alive process + "never sleep" power setting | Server runs 24/7 |
| `sslip.io` hostnames | Not needed locally; optional on a VPS before DNS is ready |
