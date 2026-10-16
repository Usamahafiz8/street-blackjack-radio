# Street Blackjack Radio: Admin Guide

This guide is for whoever runs the radio day to day. It doesn't need technical knowledge. Almost everything is done in the **AzuraCast dashboard**: a website where you log in and manage the stations.

> Menu names below are from AzuraCast 0.23. If a label looks slightly different after an update, look for the nearest match.

---

## 1. Logging in

| | |
|---|---|
| Live server | `https://radio.<your-domain>` (set up during deployment) |
| Local test PC | `http://localhost:18080` (only works on that PC) |

Log in with your email and password. Turn on **two-factor login** under *My Account → Security*. It's strongly recommended.

On the home screen, **Station Overview** lists every station, how many people are listening, and what's playing. Click **Manage** next to a station to work on it.

---

## 2. How a station plays music

Each station plays its **Rotation** playlist from top to bottom, then starts again, 24 hours a day, whether or not anyone is listening. A listener who tunes in joins at whatever is playing *right now*.

On top of that you can add:
- **Scheduled shows**: a playlist that takes over at set days and times (e.g. Friday 8–11pm).
- **Adverts and promos**: short clips played *between* mixes, every so often.

If a station ever has nothing to play, it plays a short "We'll be right back" message instead of going silent.

---

## 3. Uploading DJ mixes

### Step 1: split long mixes first (anything over about 40 minutes)
Adverts can only play *between* files, never in the middle of one. So a 3-hour mix is split into roughly 30-minute parts at natural transitions. Listeners hear the same continuous mix, with an advert break every hour or so. **Your original file is never changed.**

Whoever looks after the server runs:

```bash
node tools/split-mix/split-mix.mjs "Friday Mix.mp3" --dry-run   # preview the cut points
node tools/split-mix/split-mix.mjs "Friday Mix.mp3"             # create the parts
```

You get `Friday Mix - Part 01.mp3`, `Part 02`, and so on.
- The tool cuts at quiet moments close to every 30 minutes.
- If it can't find one, it says so. You can then give exact times from the DJ's tracklist: `--at 31:20,1:02:05,1:33:40`.
- Keep the original files somewhere safe (they aren't uploaded).

### Step 2: upload
1. *Manage* the station → **Media → Music Files**.
2. Click **Upload** and drag in the file(s). Large files are fine: uploads go in pieces and show progress. For many or very large files, ask for an **SFTP** login (*Broadcasting → SFTP Users*) and use a program like FileZilla.
3. Wait for each file to finish processing. Its length and title appear in the list.

### Step 3: put it in the Rotation
1. Tick the uploaded file(s) → **Playlists** (or **Set Playlists**) → tick **Rotation** → **Save**.
2. For split mixes, make sure the parts sit **in order** in the Rotation:
   - The Rotation plays in a fixed order ("Sequential").
   - Open *Playlists → Rotation → Reorder* to drag the parts into place.

**Tip:** name files clearly before uploading, e.g. `2026-11-01 DJ Name - Friday Mix - Part 01.mp3`. That name, or the file's title tag, is what listeners see as "now playing".

---

## 4. Playlists and play order

*Manage* the station → **Playlists**.

| Setting | What it does |
|---|---|
| **Type: General Rotation** | Normal music playlist |
| **Order: Sequential** | Plays top to bottom, then repeats. Use this for split mixes. |
| **Order: Shuffled** | Plays all files once in a random order, then reshuffles |
| **Weight** | When two music playlists are active together, a higher weight plays more often |
| **Enabled** | Untick to pause a playlist without deleting it |

To remove a mix, untick it from the playlist (it stays in the media library), or delete it under *Music Files*.

---

## 5. Scheduling shows

Example already set up: **Dancehall → "Friday Night Dancehall"**, Fridays 20:00–23:00.

1. *Playlists* → **Add Playlist** (or edit one) → give it a name and add its mixes.
2. Open the **Schedule** tab → **Add Schedule Item**:
   - **Start / End time**, e.g. 20:00–23:00.
   - **Days**, e.g. Friday.
   - Optional **Start / End date** for a one-off or a limited run.
3. Save. During that window the show plays instead of the Rotation. Afterwards the Rotation carries on by itself.
4. Check it under the station's **Schedule** view.

**Avoid "Interrupt other songs"** on schedules. It cuts off whatever is playing abruptly. Without it, the show starts at the end of the current mix part.

Times are UK time (Europe/London).

---

## 6. Adverts and promos

Each station already has an **"Ads – Station Name"** playlist.

**How often:** open the ads playlist → *Type*.

| Type | Meaning |
|---|---|
| **Once per X songs** | After every X mixes/parts. With ~30 min parts, **2** ≈ one break per hour. |
| **Once per X minutes** | At the first break after X minutes |
| **Once per hour** | At a set minute past the hour (at the next break) |

The test setup uses "once per 1 song" so adverts show up quickly while testing. **For real use, set it to 2.** One advert file plays per break, and the files take turns.

**Add an advert:**
1. Upload the clip: *Music Files* → open the **ads** folder → Upload.
2. Add it to that station's **Ads** playlist.

To run the same advert on several stations, upload it to each station.

**Limited-time campaign** (example already set up: R&B → "Promo – DJ Night campaign", 17–24 October):
1. Create a playlist named **"Promo – …"** of type *Once per X minutes* or *songs*.
2. Add the clip.
3. In **Schedule**, set a **Start date** and **End date**.

It stops on its own after the end date.

**Naming rule (important):** start advert playlist names with **"Ads"** or **"Promo"**. The station list the game uses then shows "Ad break" instead of the advert's title.

**Proof of play:** *Reports → Song Playback Timeline* lists when each advert played and how many people were listening.

Prepare adverts at a similar loudness to the music, around −14 to −16 LUFS (your audio producer will know what this means), so they don't blast or whisper.

---

## 7. Seeing what's on air and who's listening

- **Home → Station Overview**: listeners and now playing for every station.
- *Manage* a station → **Dashboard**: what's playing, what's next, recent history.
- **Reports → Statistics / Listeners**: listener numbers over time, countries, devices.
- The game and test player read the same information from the Station Registry, so they always agree.

---

## 8. Adding, disabling or removing a station

**Add an AzuraCast station:**
1. *Administration → Stations → Add Station*. Give it a name and a short name (e.g. `grime_classics`), and keep **Enable Public Pages / Public API** ticked.
2. Under *Broadcasting → Mount Points*, make sure the default stream is **MP3, 128 kbps**.
3. Set *Profile → Custom fallback file* (the "We'll be right back" message).
4. Upload mixes, create a **Rotation** and an **Ads** playlist (sections 3 and 6).

The station appears in the game's station list automatically within about 10 seconds. To set its display name, order and logo, ask whoever maintains the server to add a short entry to `registry-api/config/stations.config.json`.

**Temporarily switch a station off:** *Administration → Stations → Edit* → untick **Is Enabled**. It disappears from the game's list. Tick it again to bring it back.

**Delete a station:** *Administration → Stations → Delete*. This is permanent and removes its media, so take a backup first (section 10).

---

## 9. Outside stations (OnTop FM and others)

Outside stations aren't in AzuraCast. Listeners connect directly to the station's own stream. They're listed in one settings file on the server: `registry-api/config/stations.config.json`, under `"external"`.

OnTop FM is already in that file, switched off (`"enabled": false`). To switch it on, whoever maintains the server:
1. Gets OnTop FM's stream address from its owner, **with written permission**. It must start with **https://**; if it's `http://` only, see "OnTop FM" in `docs/stage1-findings.md`.
2. Pastes it into `"stream_url"`, sets `"enabled": true`, and saves.

The change is picked up within a minute, with no restart and no changes to the game.

The server checks every outside station once a minute. If one is down, it shows as **Offline** and can't be selected; it comes back by itself when it recovers. To add another outside station, copy the OnTop FM block and change the name, address, order and logo.

---

## 10. Backups

- *Administration → Backups*: schedule **automatic daily backups** (database and settings; tick *Exclude media* to keep them small). Keep 14.
- Keep your original mix files and adverts somewhere safe as well, e.g. a cloud drive. With those plus a backup, the whole radio can be rebuilt.
- How to restore is covered in `docs/deployment.md`.

---

## 11. When something looks wrong

| Problem | Try |
|---|---|
| A station shows Offline | *Manage* station → **Broadcasting → Restart Broadcasting**. Listeners reconnect by themselves within seconds. It starts with the next mix. |
| Hearing "We'll be right back" | The station has nothing to play: check its Rotation playlist is enabled and has files |
| An advert never plays | Check the Ads playlist is enabled, has files, and has a sensible "once per X" setting |
| A scheduled show didn't start | Check the schedule's days and times (UK time) and that the playlist has files |
| Wrong title shown | Fix the file's title under *Music Files → Edit* |

For anything else, contact whoever maintains the server, and note the time it happened.
