# Street Blackjack Radio: Test Checklist and Results

**Where tested:** local test server (AzuraCast stable on WSL2 Ubuntu 24.04, Windows PC), 16–17 October 2026.
**Stations:** 5 AzuraCast stations with synthetic test audio, plus 2 external test stations (1 working, 1 deliberately broken).
**Evidence:** files in `docs/results/` and `docs/results/screens/`.

Key: ✅ pass · ❌ failed (fixed and re-tested) · ⏳ to do (needs real devices or the production server)

---

## A. Broadcasting

| # | Test | Method | Result |
|---|---|---|---|
| A1 | Stations play continuously with **no listeners** | `check-continuous.mjs`, 40 min, 0 listeners, polls public API every 15 s | ✅ Run 2 PASS: both PoC stations, 3 gapless mix changes each, including looping back to mix 1. Run 1 ❌ caught a WSL clock fault (stream at 0.97× real time); fixed with chrony, then passed. [log](results/stage2-continuous.log) |
| A2 | Stream delivers real-time audio | 3-minute byte-rate measurement | ✅ 127.9 kbps (0.999×) after the clock fix |
| A3 | Next mix plays automatically; playlist loops | A1 + play history | ✅ Mix 4 → Mix 1 with nobody acting |
| A4 | All five stations online | Registry + AzuraCast Now Playing | ✅ uk_rap, afrobeats, dancehall, rnb, oldschool |
| A5 | Fallback ("We'll be right back") configured on every station | Setup script output | ✅ |
| A6 | Long mix split at natural transitions | `split-mix.mjs` on a 48-min mix | ✅ Cut exactly at the 3 transitions (12:00.6 / 24:01.8 / 36:03.0). At a 30-min target with no transition nearby, it **warns** and cuts at 30:00, as designed. |

## B. Adverts and scheduling

| # | Test | Method | Result |
|---|---|---|---|
| B1 | Each station plays its **own** adverts | `check-ads.mjs`, 28 min, play history of all 5 stations | ✅ All 5 stations played their own adverts during the 28-min run (2 breaks each, 10 total): UK Rap tournament promo, Afrobeats Sponsor B, Dancehall New Tables / Sponsor A, R&B tournament / Sponsor B, Old School tournament / New Tables. [log](results/stage3-ads.log) |
| B2 | Adverts start **only at a break**, never inside a mix | Same: every advert's start compared with the previous item's end | ✅ Every advert started when the previous mix ended (2–3 s overlap = crossfade); the mix after it then started on cue. The first automated pass ❌ flagged adverts from *before* the run, around station restarts (the setup script and a WSL restart). The checker now judges only the run window and labels restart cuts; raw data is kept in `results/stage3-ads-raw.json`. |
| B3 | Ad break shown as "Ad break" (no advert title) to players | Registry unit test + `Ads`/`Promo` naming rule | ✅ |
| B4 | Scheduled show stored and on AzuraCast's calendar | "Friday Night Dancehall" Fri 20:00–23:00; `/api/station/3/schedule` | ✅ Listed as a scheduled event, **and observed live**: the advert test ran on Friday evening UK time, and Dancehall played the scheduled show playlist instead of its Rotation (see the ads log). After the slot ended at 23:00 UK time, Dancehall went back to its Rotation by itself at the next break (22:01:40 UTC), without cutting the show mix. [log](results/stage3-schedule-end.log) |
| B5 | Date-limited campaign | "Promo – DJ Night campaign", 17–24 Oct, every 30 min | ✅ Start and end dates saved |

## C. Player (desktop Chrome, real local server)

| # | Test | Result |
|---|---|---|
| C1 | Radio ON joins the **live point** | ✅ (demo video) |
| C2 | Switch station → that station's own live point | ✅ |
| C3 | **Leave and return** → joins live, not where you left | ✅ Paused at 2:33, resumed after 80 s at 3:54 |
| C4 | Station restart while listening → reconnects by itself | ✅ About 2 s |
| C5 | Status stays correct during and after a restart | ❌ → ✅ AzuraCast reports "offline" for ~20 s after a restart while already streaming. The registry now checks the real stream. Re-tested: online throughout. |
| C6 | Stream drop (20 s outage) → reconnects when back | ✅ Back-off capped at 10 s |
| C7 | Offline external station greyed out, not selectable, nothing breaks | ✅ |
| C8 | External station plays directly from its own server | ✅ (SomaFM test stream) |
| C9 | Mute / volume | ✅ |
| C10 | No broken images | ❌ → ✅ Album-art fallback added |

## D. Phones

**Emulation (Chrome pretending to be a phone).** This checks layout and logic, but it is *not* a real device.

| # | Test | iPhone 13 (emulated) | Pixel 7 (emulated) |
|---|---|---|---|
| D1 | Plays, "Playing live" | ✅ | ✅ |
| D2 | No sideways scrolling, all stations visible | ✅ | ✅ |
| D3 | iPhone: no volume slider (iOS can't set it), "use device buttons" note | ❌ → ✅ The slider was still visible (CSS bug), fixed | ✅ slider shown |
| D4 | Lock-screen metadata set (Media Session) | ✅ | ✅ |

Screenshots: `results/screens/iphone-13.png`, `results/screens/pixel-7.png`.

**Real devices: ⏳ for the tester.** Use the HTTPS address (production `https://player.radio.<domain>`, or the temporary tunnel locally). Mark each cell ✅/❌ and add notes:

| Check | iPhone Safari | iPhone home-screen app | Android Chrome | Android home-screen app |
|---|---|---|---|---|
| Play / switch / pause and rejoin live | | | | |
| Lock screen: audio keeps playing | | | | |
| Lock screen: station name + play/pause shown | | | | |
| Switch to another app for 1 min, come back | | | | |
| Phone call / Siri interrupts, then "Tap to resume" works | | | | |
| Wi-Fi → mobile data while playing (reconnects) | | | | |
| Volume: device buttons (iPhone) / slider (Android) | | | | |
| Leave for 5 min, reopen → hears a later "minute N" | | | | |

If something fails, open **Diagnostics** at the bottom of the player and screenshot the event list.

## E. Security and integration

| # | Test | Result |
|---|---|---|
| E1 | Admin unreachable by listeners (local gateway / tunnel) | ✅ `/login`, `/dashboard`, `/setup`, `/api/admin/*`, `/api/nowplaying` → 404 |
| E2 | Production admin IP allow-list (Caddy) | ✅ Config validated by Caddy. Behaviour test: admin paths 403; stream, static images and public now-playing pass through. |
| E3 | No API keys in player, registry or responses | ✅ The registry uses only public endpoints; the key exists only in a mode-600 file on the server |
| E4 | CORS allow-list (exact and `*.domain`), preflight, rejected origins | ✅ Unit tests |
| E5 | Registry read-only (POST → 405) | ✅ |
| E6 | Stream URLs are HTTPS through the HTTPS tunnel (no mixed content) | ✅ |
| E7 | Registry keeps working when AzuraCast is down (marks stations offline, keeps list) | ✅ Unit test |
| E8 | Registry tests | ✅ 14 / 14 pass (`npm test` in `registry-api`) |

## F. Capacity and resilience

| # | Test | Result |
|---|---|---|
| F1 | 300 simultaneous listeners, 60 s | ✅ 300/300 at full rate (median 128.2 kbps), 0 drops, 38.5 Mbit/s total. [log](results/stage4-load-300.log) |
| F2 | 1,000 simultaneous listeners, 60 s | ✅ 1000/1000 at full rate (min 127.4 kbps), 0 drops, 128 Mbit/s total, AzuraCast ≤ 1.7 of 8 CPU cores. [log](results/stage4-load-1000.log) |
| F3 | Backup | ✅ `azuracast:backup --exclude-media`: 0.66 s, 26 KB with the full database. [log](results/stage4-backup.log) |
| F4 | Restore drill | ⏳ On a spare server after go-live (see deployment.md §5). It wasn't run here because it overwrites the running install. |
| F5 | Recovery after the PC/VM stops | ❌ → ✅ The WSL VM shut down when its keep-alive process ended with a terminal. The start script now runs it detached. *(Local test setup only; a server doesn't have this problem.)* |

## G. Still to do (needs the production server or real devices)

1. Real-device checklist (section D).
2. A1, B1/B2 and F1 re-run on the production server (deployment.md §4).
3. Restore drill (F4).
4. OnTop FM: test with its real HTTPS stream once provided.
5. Radio together with the game's sounds and voice chat on iPhone (game developer; see api.md).
