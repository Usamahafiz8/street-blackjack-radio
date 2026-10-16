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

## Your steps

### 1. Create the AzuraCast admin account (5 min, on this PC only)
1. Open **http://localhost:18080** in your browser on this PC.
2. Create the **Super Administrator** account. Use your email and a strong password, and save it in your password manager.
3. If it asks you to create a station, create:
   - Name: `UK Rap / Drill / Grime`
   - Short name: `uk_rap`

   My script will adopt it.
4. On **System Settings**, set **Site Base URL** to `http://localhost:18080` and save.

### 2. Create an API key and store it inside WSL (3 min)
1. In AzuraCast, open the top-right menu → **My Account** → **API Keys** → **Add API Key**. Name it `provisioning`, then copy the key.
2. Open **PowerShell** and enter the WSL distro (no password needed):

   ```powershell
   wsl -d Ubuntu-24.04 -u root
   ```

3. Paste this line and press Enter. Then paste the key when asked; nothing will show on screen, which is normal.

   ```bash
   read -rs -p "Paste AzuraCast API key: " K && printf 'AZURACAST_API_KEY=%s\n' "$K" > /opt/sbradio/secrets/azuracast-api.env && chmod 600 /opt/sbradio/secrets/azuracast-api.env && unset K && echo " saved"
   ```

4. Type `exit`, and tell me **"API key saved"**. Please don't send the key itself.

### 3. Stop the PC sleeping during the continuous-playback test
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

### 4. Phone testing: pick one or both

**A. Temporary HTTPS tunnel (recommended for iPhone).** It works on Wi-Fi *or* mobile data, and needs no firewall change. HTTPS is required for lock-screen controls, Add to Home Screen (PWA) and background-playback tests.
1. Install Cloudflare's tunnel tool (free, no account needed):

   ```powershell
   winget install --id Cloudflare.cloudflared
   ```

2. Close and reopen PowerShell, then start the stack with a tunnel:

   ```powershell
   powershell -ExecutionPolicy Bypass -File D:\radio\infra\local\start-local.ps1 -Tunnel
   ```

3. It prints an address like `https://random-words.trycloudflare.com`. Open it on your iPhone.
4. The tunnel exposes **only the gateway**: the player, the station list and the audio. The AzuraCast dashboard isn't reachable through it.
5. The address changes every time, and stops working when you run `stop-local.ps1` or restart the PC.
6. Cloudflare quick tunnels are meant for testing only.

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
| Cloudflare quick tunnel for phone HTTPS | Not needed: the real domain has HTTPS |
| Keep-alive process + "never sleep" power setting | Server runs 24/7 |
| `sslip.io` hostnames | Not needed locally; optional on a VPS before DNS is ready |
