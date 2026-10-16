# Stage 2: Proof of Concept

**Goal:** two 24/7 test stations (UK Rap, Afrobeats) on AzuraCast, a basic Station Registry API, and a basic player that switches between them and an external test station. Plus proof that the stations keep playing with no listeners, and that leaving and coming back joins the live position.

## Status

| Part | State |
|---|---|
| Registry API (`/registry-api`) | **Built and tested.** 10 automated tests pass: merging, HTTPS URL rewriting, ad-break hiding, external online/offline, CORS allow-list, read-only, AzuraCast outage. Checked against a real public HTTPS stream. |
| Test player (`/player`) | **Built and tested locally** against a mock AzuraCast: play, pause/rejoin, station switching, stream drop with automatic reconnect, offline station greyed out, phone-width layout. PWA manifest, service worker, Media Session lock-screen controls. |
| Continuous-playback checker | **Built and tested** against the mock (PASS, with mix changes and no gaps). |
| Server scripts (`/infra`) | **Written, not yet run.** They need the test VPS. |
| AzuraCast stations + test audio | **Waiting for the VPS** (see [stage2-vps-setup.md](stage2-vps-setup.md)) |
| iPhone / Android tests on real devices | Quick checks at the end of Stage 2; formal test matrix in Stage 4 |

## What gets built on the server

**Stations:**

| Station | Short name | Playlist | Stream (MP3 128 kbps) |
|---|---|---|---|
| UK Rap / Drill / Grime | `uk_rap` | "Rotation", sequential, loops forever | `https://RADIO_DOMAIN/listen/uk_rap/radio.mp3` |
| Afrobeats / Amapiano | `afrobeats` | "Rotation", sequential, loops forever | `https://RADIO_DOMAIN/listen/afrobeats/radio.mp3` |

Each station also has:
- **HLS** enabled (at `/hls/...`), for testing later;
- a **fallback file** ("We'll be right back"), so the stream is never silent if a playlist breaks;
- requests, on-demand and live DJs **disabled**.

**Test audio:** 4 × 12-minute "mixes" per station, generated on the server by `generate-test-audio.sh`.
- They're entirely synthetic (ffmpeg tone and drum generator plus espeak-ng voice), so there's **no licensing question at all**.
- A voice says **"UK Rap. Test mix 2. Minute 7."** at the start of every minute. You can *hear* where the broadcast is.
- The tone also rises one step each minute.
- Encoded at 320 kbps to match what DJs will deliver.

**External stations in the registry:**
- `external-test`: a public SomaFM stream, development only, standing in for OnTop FM.
- `offline-test`: a deliberately dead URL, to show offline handling.

## Deployment runbook (what I run once I have access)

From this PC (Git Bash), with `HOST=ubuntu@SERVER_IP` and `KEY=~/.ssh/sbradio_ed25519`:

```bash
# 1. Harden the server
scp -i $KEY infra/scripts/bootstrap-server.sh infra/scripts/install-azuracast.sh $HOST:~/
ssh -i $KEY $HOST 'sudo bash ~/bootstrap-server.sh'

# 2. Install AzuraCast (stable), moved to internal port 8080
ssh -i $KEY $HOST 'sudo bash ~/install-azuracast.sh'

# 3. Server settings (domains, cert email, CORS) -> /opt/sbradio/config/sbradio.env, then:
infra/scripts/deploy.sh $HOST        # Caddy + registry + player, HTTPS certificates issued

# 4. YOU: create the admin account through the SSH tunnel and save the API key (stage2-vps-setup.md, steps 5-6)

# 5. Test audio + stations
ssh -i $KEY $HOST 'bash /opt/sbradio/app/infra/scripts/generate-test-audio.sh'
ssh -i $KEY $HOST 'sudo docker run --rm --network host \
  --env-file /opt/sbradio/secrets/azuracast-api.env --env-file /opt/sbradio/config/sbradio.env \
  -v /opt/sbradio/app/infra:/infra:ro -v /opt/sbradio/test-audio:/media:ro \
  node:22-alpine node /infra/scripts/provision-stations.mjs /infra/stations.poc.json /media'

# 6. Proof of continuous playback (30+ min, nobody listening)
node infra/scripts/check-continuous.mjs --base https://RADIO_DOMAIN --minutes 40 --out docs/results/stage2-continuous.json
```

The results of step 6 will be saved in `docs/results/` and summarised in this document.

## How you can check it yourself

You'll get three links:

| | URL |
|---|---|
| **Player** | `https://PLAYER_DOMAIN` |
| **API** | `https://API_DOMAIN/v1/stations` |
| **AzuraCast** | `https://RADIO_DOMAIN` (log in with the account you created) |

### Test 1: Stations play with nobody listening
1. Make sure nobody has the player open.
2. Open AzuraCast → **UK Rap** station → **Dashboard**. Note the current mix, how far into it it is, and **Listeners: 0**.
3. Close the tab and wait **10 minutes**.
4. Open the dashboard again. The position has moved on by about 10 minutes, or the next mix has started. Listeners was 0 the whole time.

My automated version of this test (`check-continuous.mjs`) does the same every 15 seconds for 40 minutes and checks that each new mix starts exactly when the previous one ends.

### Test 2: Leave and come back joins the live position
1. Open the player, choose **UK Rap**, press **Play**. You'll hear e.g. "*UK Rap. Test mix 2. Minute 3.*" The screen shows e.g. "3:10 / 12:00 into this mix".
2. Press **Pause**, or close the tab/app completely.
3. Wait **5 minutes**.
4. Press **Play** (or reopen the player and press Play). You'll hear "*…Minute 8*" (or the next mix), **not** minute 3. The screen shows about 8:10.

That's the core of the brief: it's a broadcast, not an on-demand playlist.

### Test 3: Switching stations
- While playing, tap **Afrobeats**. Audio switches within a few seconds to "*Afrobeats. Test mix N. Minute M*", at Afrobeats' own live position.
- Tap back to **UK Rap**. It's still at its own live position, which kept moving while you were away.

### Test 4: External and offline stations
- **External Test (SomaFM)** plays a third-party live stream directly. The player connects straight to it, not via our server.
- **Offline Test Station** is greyed out with "Offline", can't be selected, and nothing breaks.

### Test 5: Recovery after a restart
- In AzuraCast → UK Rap → **Restart Broadcasting** while listening in the player.
- The player shows "Reconnecting…" and resumes on its own, usually within 5–15 seconds, at the live position.

### Test 6: iPhone (quick check now; full matrix in Stage 4)
1. Open the player link in **Safari**, press Play, then **lock the phone**. Audio should keep playing, and the lock screen should show the station name with play/pause.
2. Unlock and switch to another app for a minute, then come back. Audio should still be playing, or show "Tap ▶ Play to resume" if iOS paused it.
3. Share → **Add to Home Screen**, open it from the home screen, and repeat steps 1–2. Tell me what happens. This is the PWA case we need to confirm on a real device.
4. Note: on iPhone there's **no volume slider**, only Mute. Use the phone's volume buttons. This is an iOS restriction (see Stage 1 findings §4.2).

## Local development (no server needed)

```bash
node registry-api/tools/mock-azuracast.mjs          # fake AzuraCast with live test tones on :8081
cd registry-api && AZURACAST_INTERNAL_URL=http://localhost:8081 AZURACAST_PUBLIC_URL=http://localhost:8081 \
  PUBLIC_BASE_URL=http://localhost:3000 CORS_ORIGINS='*' ALLOW_INSECURE_STREAMS=true node src/index.js
PORT=8097 node player/tools/dev-server.mjs           # open http://localhost:8097/?api=http://localhost:3000
curl "localhost:8081/admin/kill/uk_rap?s=20"         # simulate a 20 s stream drop
```

## Local test results (16 Oct 2026)

| Test | Result |
|---|---|
| Registry unit/integration tests (`npm test`) | 10/10 pass |
| External health check against a real HTTPS stream | online ✔ |
| Health check against an unreachable host | offline (`unreachable`) ✔ |
| Player: play → "Playing live" | ✔ |
| Player: switch UK Rap → Afrobeats | ✔ (reconnects to the new live stream) |
| Player: 20 s stream drop | ✔ (reconnected automatically once the stream returned; retry back-off capped at 10 s) |
| Player: offline station greyed out and not selectable | ✔ |
| Player at 375 px phone width | ✔ |
| Continuity checker vs mock (40 s mixes) | PASS: 2 mix changes, 0 s gaps, 0 listeners |

## Results on the real local AzuraCast (WSL2, 16 Oct 2026)

AzuraCast stable on WSL2 Ubuntu 24.04 (see [stage2-local.md](stage2-local.md)). Two stations, each with 4 × 12-minute synthetic mixes, 128 kbps MP3.

| Test | Result |
|---|---|
| **Continuous playback, no listeners, 40 min, run 1** | **FAIL, correctly detected.** WSL2's clock ran at 0.965× real time, so every mix took about 12:30. Fixed with chrony (see stage2-local.md). |
| **Continuous playback, no listeners, 40 min, run 2** | **PASS** for both stations. 160 samples each, 0 listeners throughout, 3 mix changes each (Mix 2→3→4→**1**: the playlist looped by itself), gaps −2 to −4 s (normal short crossfade). [log](results/stage2-continuous.log) · [json](results/stage2-continuous.json) |
| Stream rate after the clock fix | 127.9 kbps (0.999× real time) |
| Registry → AzuraCast | Both stations online. Stream, HLS and art URLs follow the client's address (localhost / Wi-Fi / HTTPS tunnel). |
| External test station (SomaFM) | online |
| Offline test station | offline, greyed out, not selectable |
| Player: Play | "Playing live" within about 1 s |
| Player: switch UK Rap → Afrobeats | switched to Afrobeats' own live position |
| **Leave and return** | paused at 5:18 into the mix (12:40:13), pressed Play at 12:41:20, and it resumed at **6:25**: +67 s, matching the wall clock. **Joins live, not where it left off.** |
| Station restart while listening | the stream dropped; the player reconnected automatically within about 2 s |
| Admin exposure | Through the gateway and the HTTPS tunnel, `/login`, `/dashboard`, `/setup`, `/api/admin/*` and `/api/nowplaying` all return **404**. The admin is only on `http://localhost:18080`. |
| Audio through the HTTPS tunnel | 200 `audio/mpeg`, HTTPS stream URLs (no mixed content) |

**Behaviour to know:** after a station *restart*, AzuraCast starts the **next** mix from its beginning; it doesn't resume mid-mix. Normal 24/7 running isn't affected.

**Still to do on a real iPhone (you):** lock-screen controls, background playback, and Add to Home Screen. Steps are in [stage2-local.md](stage2-local.md). The full device matrix is in Stage 4.

## Known limitations at this stage
- No adverts yet (Stage 3).
- 2 of 5 stations (Stage 3).
- HLS is enabled on the server but the player uses MP3. Whether iPhone should prefer HLS is decided in Stage 4.
- The registry's `stations.config.json` is edited in the repo and redeployed. A simpler way for a non-technical admin to add external stations comes in Stage 3.
