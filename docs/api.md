# Street Blackjack Radio: Station Registry API

For the Street Blackjack game developer. Everything the game needs is in **one read-only JSON endpoint** plus the audio stream URLs it returns. The radio runs on its own servers. If it's down, the game must carry on normally (see [Resilience](#resilience-the-game-must-never-depend-on-the-radio)).

| | Production (after deployment) | Local test |
|---|---|---|
| API base | `https://api.radio.<domain>` | `http://localhost:8088` |
| Streams | `https://radio.<domain>/listen/<station>/radio.mp3` | `http://localhost:8088/listen/...` |

---

## Endpoints

| Method | Path | Returns |
|---|---|---|
| `GET` | `/v1/stations` | `{ generated_at, stations: Station[] }`, all visible stations, sorted for display |
| `GET` | `/v1/stations/{id}` | One `Station`, or `404 {"error":"station_not_found"}` |
| `GET` | `/health` | Service status (for monitoring, not needed by the game) |
| `GET` | `/art/{file}` | Station artwork (SVG/PNG) |

- **Authentication:** none. Everything is public, read-only listener information. No API keys exist in the API or the player, and none must ever be added to the game.
- **Methods:** only `GET`, `HEAD` and `OPTIONS`. Anything else returns `405`.
- **Caching:** responses carry `Cache-Control: public, max-age=5`. Data refreshes from the broadcast server about every 10 s, so polling faster than every 10 s gains nothing.
- **Versioning:** `/v1` won't change incompatibly. New fields may be added, so ignore fields you don't use.

## The `Station` object

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable ID, e.g. `uk-rap`, `afrobeats`, `dancehall`, `rnb`, `oldschool`, `ontop-fm`. **Safe to store** (e.g. a player's last station). |
| `type` | `"azuracast"` \| `"external"` | `external` = a third-party live station (e.g. OnTop FM), streamed directly from its own server |
| `name` | string | Display name |
| `genre` | string \| null | |
| `description` | string \| null | |
| `online` | boolean | **Only offer stations where this is `true`.** |
| `status` | `"online"` \| `"offline"` \| `"unknown"` | `unknown` = not checked yet (first seconds after a restart) |
| `status_reason` | string \| null | Why offline: `azuracast_unreachable`, `azuracast_station_offline`, `unreachable`, `timeout`, `http_<code>`, `not_audio`, `no_data`, `insecure_http_stream` |
| `stream.url` | string | **The audio URL to play** (HTTPS in production, MP3 128 kbps) |
| `stream.format`, `stream.bitrate` | string, number \| null | |
| `streams[]` | array | All available streams (same shape). Today just one. |
| `hls_url` | string \| null | Optional HLS version (iOS can play it natively). Not needed; use `stream.url`. |
| `artwork_url` | string \| null | Station logo (square) |
| `listeners` | `{ current, unique }` \| null | `null` when unknown (most external stations) |
| `now_playing` | object \| null | See below. `null` = nothing known (e.g. external station without stats). |

`now_playing`:

| Field | Type | Notes |
|---|---|---|
| `title`, `artist` | string \| null | E.g. mix name and DJ |
| `programme` | string \| null | Playlist/show name, e.g. "Rotation", "Friday Night Dancehall" |
| `is_ad_break` | boolean | `true` during adverts/promos. Title fields are then `null`; show "Ad break" or similar. |
| `started_at` | ISO time \| null | When the current item started |
| `duration_s`, `elapsed_s` | number \| null | Use `started_at` + local clock to animate progress between polls |
| `art_url` | string \| null | Track/mix art if any. Prefer `artwork_url` (station logo) for a consistent look. |

### Example: `GET /v1/stations` (production addresses shown)

```json
{
  "generated_at": "2026-10-16T21:10:33.292Z",
  "stations": [
    {
      "id": "uk-rap",
      "type": "azuracast",
      "name": "UK Rap / Drill / Grime",
      "genre": "UK Rap",
      "description": "UK Rap, Drill and Grime - 24/7",
      "online": true,
      "status": "online",
      "status_reason": null,
      "stream": { "url": "https://radio.example.com/listen/uk_rap/radio.mp3", "format": "mp3", "bitrate": 128 },
      "streams": [{ "url": "https://radio.example.com/listen/uk_rap/radio.mp3", "format": "mp3", "bitrate": 128 }],
      "hls_url": "https://radio.example.com/hls/uk_rap/live.m3u8",
      "artwork_url": "https://api.radio.example.com/art/uk-rap.svg",
      "listeners": { "current": 0, "unique": 0 },
      "now_playing": {
        "title": "Test Mix 1",
        "artist": "SBR Test DJ (UK Rap)",
        "programme": "Rotation",
        "art_url": "https://radio.example.com/api/station/uk_rap/art/eab17a193c18e4f8a225d322",
        "is_ad_break": false,
        "started_at": "2026-10-16T21:08:23.000Z",
        "duration_s": 720,
        "elapsed_s": 130
      }
    },
    {
      "id": "ontop-fm",
      "type": "external",
      "name": "OnTop FM",
      "genre": "UK Urban - Live",
      "online": true,
      "status": "online",
      "status_reason": null,
      "stream": { "url": "https://<ontop-fm-stream>", "format": "mp3", "bitrate": null },
      "hls_url": null,
      "artwork_url": "https://api.radio.example.com/art/ontop-fm.svg",
      "listeners": null,
      "now_playing": null
    },
    {
      "id": "offline-example",
      "type": "external",
      "name": "Some Station",
      "online": false,
      "status": "offline",
      "status_reason": "unreachable",
      "stream": { "url": "https://...", "format": "mp3", "bitrate": 128 },
      "now_playing": null
    }
  ]
}
```

*(The real response has all fields on every station; some are shortened above for space. This example is taken from the live local test server, with addresses replaced.)*

---

## CORS

The API answers browser requests from an **allow-list of origins**. In production it's the `CORS_ORIGINS` setting on the radio server (`/opt/sbradio/config/sbradio.env`), for example:

```
CORS_ORIGINS=https://play.streetblackjack.com,https://*.streetblackjack.com,https://player.radio.example.com
```

- Send the radio team your game's exact origin(s), including staging.
- Wildcard sub-domains (`https://*.example.com`) are supported.
- Preflight (`OPTIONS`) is handled automatically and cached for 24 h.
- **The audio streams don't need CORS** when played with an `<audio>` element. They only need it if you route them through the Web Audio API (see the iOS section). AzuraCast's Icecast streams echo the requesting origin in `Access-Control-Allow-Origin` anyway (checked on the test server).
- Native apps (not browsers) aren't affected by CORS at all.

---

## How the game should play the radio

Each player's device makes its **own** connection to the stream it chose. There's no server-side session, no login, and nothing shared between players. Six players at one table can be on six different stations, or have the radio off. The game server isn't involved at all.

**Rules that matter:**
1. **One `<audio>` element per player client**, reused for every station. Don't create a new element per station; iOS may block it.
2. **Start playback from a user tap** (the radio button). Browsers, iOS especially, block audio that starts without one.
3. **Switch station:** set `audio.src = station.stream.url + cacheBuster` and call `play()` in the click handler.
4. **Pause = stop.** It's a live broadcast: pausing should *disconnect* (`pause()`, remove `src`, `load()`), and resuming should connect again to the live point. This also stops paying for bandwidth while paused, and keeps "no pause/rewind" true for music licensing.
5. **Reconnect automatically** on `error`, `ended` or `stalled`, or if playback stops advancing for ~12 s. Back off 1 s → 2 s → 4 s → 7 s → 10 s, then retry every 10 s while the player still wants radio.
6. **When the app returns to the foreground** (`visibilitychange` / `pageshow`), if audio should be playing but isn't, reconnect to the live point.
7. **Only offer `online: true` stations.** Refresh the list every 15–30 s while the radio UI is visible.
8. If `play()` is rejected with `NotAllowedError` (e.g. after a phone call on iOS), show **"Tap to resume"** instead of retrying.

Minimal example (plain JS):

```js
const API = 'https://api.radio.example.com';
const audio = new Audio();          // one per player
audio.preload = 'none';
let wanted = null;                  // station the player chose, or null = radio off

async function stations() {
  const r = await fetch(`${API}/v1/stations`, { signal: AbortSignal.timeout(4000) });
  return (await r.json()).stations.filter((s) => s.online);
}

function playStation(station) {     // call from a click/tap handler
  wanted = station;
  const u = station.stream.url;
  audio.src = u + (u.includes('?') ? '&' : '?') + '_t=' + Date.now(); // fresh live connection
  audio.play().catch((e) => { if (e.name === 'NotAllowedError') showTapToResume(); });
}

function radioOff() {
  wanted = null;
  audio.pause(); audio.removeAttribute('src'); audio.load(); // disconnect
}

let retry = 0;
audio.addEventListener('playing', () => { retry = 0; });
for (const ev of ['error', 'ended']) audio.addEventListener(ev, () => {
  if (!wanted) return;
  setTimeout(() => wanted && playStation(wanted), [1000, 2000, 4000, 7000, 10000][Math.min(retry++, 4)]);
});
```

The standalone test player (`/player/app.js`) is a complete, tested reference: watchdog, lock-screen metadata, offline handling and foreground return.

### Lock screen / notification controls (Media Session)
Set `navigator.mediaSession.metadata` (title, artist = station name, artwork = `artwork_url`) and handlers for `play`, `pause` and `stop`, and optionally `nexttrack`/`previoustrack` for changing station. Set `seekto`, `seekforward` and `seekbackward` to `null`, because it's live.

---

## Mixing with game sounds and voice chat (important on iPhone)

| Topic | What to know |
|---|---|
| **Volume on iOS** | iOS ignores `audio.volume` (always 1). Only the hardware buttons change it. `muted` works. For an in-game radio volume slider on iOS you'd have to route the stream through Web Audio (`createMediaElementSource` → `GainNode`), which needs `crossOrigin="anonymous"` on the audio element and becomes subject to the silent switch and background suspension. **Recommendation:** on iOS, offer mute instead of a slider. |
| **Silent switch** | `<audio>` media keeps playing with the ring/silent switch on silent. Web Audio game sounds may be silenced. Expect that difference. |
| **Voice chat (WebRTC)** | When the microphone is in use, iOS switches to a "play and record" audio session. Output can move to the earpiece or drop in volume, and other audio may be ducked. Test radio together with voice chat on real iPhones. Muting the radio while someone is talking is a reasonable default. |
| **`navigator.audioSession`** | Safari's `navigator.audioSession.type` (`'playback'` / `'ambient'`) changes how the page's audio mixes with other apps. Behaviour has varied between iOS versions, so test before relying on it. |
| **Background / lock** | A plain `<audio>` element keeps playing when the screen locks in Safari. Home-screen (PWA) mode must be verified per iOS version; it's in the device test checklist. |
| **Data use** | 128 kbps ≈ 58 MB per hour of listening. |

---

## Resilience: the game must never depend on the radio

- Call the API with a **short timeout (3–5 s)** and treat any failure as "radio unavailable". Never block game start-up on it.
- Cache the last station list locally and show it greyed out while the API is unreachable.
- The radio is on a separate server and domain. Nothing in the game's own hosting is shared.
- If AzuraCast restarts, `online` stays truthful: the registry checks the actual streams, and players reconnect by themselves.

---

## `/health`

```json
{
  "ok": true,
  "azuracast": { "reachable": true, "last_success_at": "2026-10-16T21:10:28.375Z", "last_error": null },
  "external": {
    "ontop-fm": { "online": true, "reason": null, "checked_at": "2026-10-16T21:09:47.021Z" }
  }
}
```

Use it for uptime monitoring. The game doesn't need it.

## Adding stations

New AzuraCast stations and new external stations appear in `/v1/stations` automatically (see `docs/admin-guide.md`, sections 8–9). **No game update is needed.** Just render whatever list comes back.
