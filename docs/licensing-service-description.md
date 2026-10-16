# Street Blackjack Radio: Service Description for Music Licensing

*Prepared for discussions with **PPL** and **PRS for Music**. It describes how the service works technically, so the licensing bodies can advise which licences apply. Items in [square brackets] need the owner's details or decisions before sending. This is a factual description, not legal advice.*

**Version:** draft, 16 October 2026

---

## 1. Who we are

| | |
|---|---|
| Service name | Street Blackjack Radio |
| Operator | [Legal name of company / sole trader], [registered address] |
| Contact | [Name, email, phone] |
| Related product | *Street Blackjack*, an online multiplayer card game operated by [the same entity / a related entity] |
| Planned launch | [month/year] |

## 2. What the service is

Street Blackjack Radio is a set of **continuous, non-interactive internet radio channels** (linear webcasts). Each channel broadcasts one programme stream, 24 hours a day, whether or not anyone is listening. Every listener of a channel hears the same audio at the same time. A listener who tunes in joins the broadcast at its current point, not at the start of a programme.

**Channels operated by us: 5 at launch**

| # | Channel | Content |
|---|---|---|
| 1 | UK Rap / Drill / Grime | Pre-recorded DJ mixes |
| 2 | Afrobeats / Amapiano | Pre-recorded DJ mixes |
| 3 | Dancehall / Reggae | Pre-recorded DJ mixes |
| 4 | R&B / Slow Jams | Pre-recorded DJ mixes |
| 5 | Old School / Hip-Hop Classics | Pre-recorded DJ mixes |

**Third-party station (not operated by us):** OnTop FM, an independent internet radio station, is offered as an extra listening option. Listeners connect **directly to OnTop FM's own stream**. We don't receive, store, rebroadcast or alter its audio; we only list it. OnTop FM is responsible for its own licensing. [Confirm with PPL/PRS that linking to a third party's licensed stream needs no licence from us.]

More channels may be added later. We'll notify you before each one launches.

## 3. Content and programming

- **Source material:** DJ mixes of commercially released recordings, supplied by [DJs / the operator]. Each mix is typically 1–3 hours and is delivered as a 320 kbps MP3.
- **Permission from DJs:** [Describe the arrangement with DJs: written permission to broadcast their mixes.]
- **Preparation:** to allow short breaks, each long mix is split into parts of about 30 minutes at natural transitions. The parts always play in their original order. The recordings themselves aren't edited.
- **Scheduling:** an automated playout system (AzuraCast / Liquidsoap) plays each channel's library in rotation and to a schedule.
- **Library size and repeat cycle:**
  - At launch: about **[20–50] hours of mixes per channel**.
  - A channel's rotation therefore lasts **[20–50] hours** before it repeats, well over 3 hours.
  - The library will grow over time.
- **Tracklists for reporting:** each mix contains many tracks. Because the files are DJ mixes, the playout system logs *mixes*, not individual tracks.
  - We can supply per-channel logs of which mix played when, with listener counts.
  - Track-level reporting needs a tracklist (cue sheet) for each mix, which we will [request from DJs].
  - [Ask PPL/PRS what reporting format they need for DJ mixes.]

## 4. How listeners access it

- **Delivery:** audio is streamed over HTTPS from a server in the UK, as MP3 at 128 kbps. [An HLS version of the same stream may be added.]
- **Where:**
  1. **Inside the Street Blackjack game.** Players switch the radio on, choose a channel, and listen while they play.
  2. During development only: a test web player that isn't publicly promoted.
  3. [Will there be a public website or app where anyone can listen without the game? Yes / No]
- **Login:** the game requires players to [create an account and log in / play as guests]. The radio is heard **inside the game after login**. [Confirm.] The stream address itself is **not password-protected or encrypted**: anyone who has it can listen. [Ask PPL/PRS whether in-game, after-login access counts as a "closed network" under their terms.]
- **Price:** [the game is free to play / has paid features]. There is **no subscription or payment to listen to the radio.**
- **Territories:**
  - Primarily the **United Kingdom**.
  - Because it's an internet service, it can technically be heard worldwide unless geo-restricted. [State whether you'll restrict to the UK, and expected non-UK audience share.]

## 5. What listeners can and cannot do

| Listeners **can** | Listeners **cannot** |
|---|---|
| Switch the radio on and off | Choose, request or skip a track or mix |
| Choose one of the channels | Pause and resume from the same point (time-shift). Pressing "pause" disconnects; resuming rejoins the live broadcast at its current point. |
| Mute, and change volume | Rewind, fast-forward or seek |
| See what is currently playing (mix name / DJ) | Download, save or cache audio for offline listening |
| | Hear anything on demand |

Each player in a game session listens independently. For example, six players at one table might be on six different channels, or have the radio off.

## 6. Funding and advertising

- **Advertising-supported:** short pre-recorded audio adverts (15–30 seconds) play **between mixes or mix parts**, never over or inside the music.
- **Advertisers:**
  - At launch: **[Street Blackjack's own promotions only / Street Blackjack promotions plus third-party sponsors]**, such as tournaments, events and DJ promotions.
  - Planned: [third-party sponsors / no third parties yet].
  - [Ask PPL whether a service whose only advertiser is the operator's own game counts as "funded by a sole advertiser".]
- **Advert frequency:** about [X] minutes of adverts per hour, per channel.
- **Expected radio revenue in year one:** [£ amount, or "none directly; the radio supports the game"].

## 7. Expected audience

| | Year 1 estimate |
|---|---|
| Typical concurrent listeners (all channels) | [e.g. 20–100] |
| Peak concurrent listeners | [e.g. 300] |
| Estimated total listening hours per year | [estimate] |

AzuraCast records listener numbers, so we can report actual figures.

## 8. Questions for the licensing bodies

1. Which licence(s) do we need for **five channels** of DJ-mix content? PPL Linear Webcast Licence per channel, plus which PRS for Music licence (LOML or the internet radio licence)?
2. Does the radio being heard **inside a game after login** count as a closed network or password-protected service?
3. Does being funded by **adverts for the operator's own game** count as "a sole advertiser"? Does adding third-party sponsors change that?
4. Are **"pause = disconnect, resume = rejoin live"**, **mute**, and **channel choice** acceptable listener controls?
5. What **reporting** do you need for DJ mixes, and in what format?
6. Does including **OnTop FM** (a direct link to its own stream) affect our licence?
7. What applies if listeners outside the UK can hear the service?
