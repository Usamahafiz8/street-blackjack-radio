#!/usr/bin/env node
// Records a client demo video of the Stage 2 proof of concept, running on the LOCAL stack
// (AzuraCast in WSL + registry + gateway on http://localhost:8088).
//
//   cd tools/demo-video && npm install && node record-demo.mjs
//   -> D:\radio\demo-output\street-blackjack-radio-stage2-demo.mp4
//
// How it works (honest by design):
//   - Real Chrome (headless) drives the real player. Screen frames come from Chrome's screencast.
//   - Headless Chrome can't capture its own audio, so every time the player connects to a station,
//     this script opens the SAME live stream in parallel (ffmpeg in WSL) and records it. The
//     soundtrack is therefore the live broadcast the player was receiving at that moment.
//   - The test audio is synthetic (spoken "minute N" markers), so no third-party music appears.
//     The external SomaFM test station is shown in the list but deliberately not played.
//   - Long waits are sped up and labelled "sped up" on screen.
//   - The local admin login is read from the WSL secrets file and never printed.
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORK = join(ROOT, '.demo-work');
const WORK_WSL = '/mnt/d/radio/.demo-work';
const OUT_DIR = join(ROOT, 'demo-output');
const OUT = join(OUT_DIR, 'street-blackjack-radio-stage2-demo.mp4');
const PLAYER = 'http://localhost:8088/';
const ADMIN = 'http://localhost:18080';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DISTRO = 'Ubuntu-24.04';
const W = 640, H = 960;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const wsl = (args, opts = {}) => execFileSync('wsl.exe', ['-d', DISTRO, '-u', 'root', '--', ...args], { encoding: 'utf8', ...opts });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
// Run a bash script inside WSL via a file (avoids Windows command-line quoting problems).
const wslScript = (name, body, opts = {}) => {
  writeFileSync(join(WORK, name), body.replace(/\r/g, ''));
  return wsl(['bash', `${WORK_WSL}/${name}`], opts);
};

// ---------------------------------------------------------------- timeline bookkeeping
const frames = [];          // { t, file }
const speedups = [];        // { from, to, factor }  wall-clock ranges shown faster
const audio = [];           // { from, to, file }    wall-clock ranges with audio
let rec = null;             // current recorder

function startRecording(shortcode) {
  stopRecording();
  const name = `rec-${audio.length}-${shortcode}.mp3`;
  const from = now();
  spawn('wsl.exe', ['-d', DISTRO, '-u', 'root', '--', 'ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-t', '400',
    '-i', `http://127.0.0.1:18080/listen/${shortcode}/radio.mp3`, '-c', 'copy', `${WORK_WSL}/${name}`], { stdio: 'ignore', windowsHide: true });
  rec = { from, file: name };
}
function stopRecording() {
  if (!rec) return;
  audio.push({ from: rec.from, to: now(), file: rec.file });
  try { wsl(['pkill', '-f', rec.file]); } catch { /* already ended */ }
  rec = null;
}

// Map wall-clock time to video time, compressing the sped-up ranges.
function videoTime(t, t0) {
  let v = t - t0;
  for (const s of speedups) {
    const a = Math.max(s.from, t0), b = Math.min(s.to, t);
    if (b > a) v -= (b - a) * (1 - 1 / s.factor);
  }
  return v;
}

// ---------------------------------------------------------------- page helpers
async function caption(page, title, sub = '') {
  await page.evaluate(([title, sub]) => {
    let el = document.getElementById('demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:14px 18px 16px;' +
        'background:rgba(10,12,16,.92);border-top:2px solid #f2b134;color:#fff;font:600 17px/1.35 system-ui,Segoe UI,sans-serif';
      el.innerHTML = '<div id="dc-title"></div><div id="dc-sub" style="font-weight:400;font-size:14px;color:#c9ced8;margin-top:4px"></div>' +
        '<div id="dc-clock" style="position:absolute;right:14px;top:10px;font:500 12px ui-monospace,Consolas,monospace;color:#f2b134"></div>';
      document.body.appendChild(el);
      document.body.style.paddingBottom = '120px';
      setInterval(() => { document.getElementById('dc-clock').textContent = 'real time ' + new Date().toLocaleTimeString('en-GB'); }, 250);
    }
    document.getElementById('dc-title').textContent = title;
    document.getElementById('dc-sub').textContent = sub;
  }, [title, sub]);
}

async function stationState(page) {
  return page.evaluate(() => ({
    status: document.getElementById('status')?.textContent,
    meta: document.getElementById('now-meta')?.textContent,
    station: document.getElementById('now-station')?.textContent,
  }));
}

async function registryStation(id) {
  const r = await fetch(`http://localhost:8088/v1/stations/${id}`);
  return r.json();
}
// Seconds until the station's next spoken "minute" marker.
async function secondsToNextMarker(id) {
  const s = await registryStation(id);
  const elapsed = (Date.now() - Date.parse(s.now_playing.started_at)) / 1000;
  return 60 - (elapsed % 60);
}

async function clickStation(page, name) {
  await page.locator('.station', { hasText: name }).click();
}

// ---------------------------------------------------------------- main
async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(WORK, 'frames'), { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // Pre-flight
  const list = await (await fetch(`${PLAYER}v1/stations`)).json();
  const online = list.stations.filter((s) => s.type === 'azuracast' && s.online).map((s) => s.id);
  if (!online.includes('uk-rap') || !online.includes('afrobeats')) throw new Error('Local stack not ready: run infra/local/start-local.ps1');
  const creds = Object.fromEntries(wsl(['cat', '/opt/sbradio/secrets/azuracast-admin.env']).split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(PLAYER);
  await page.waitForSelector('.station');

  // Screencast
  const cdp = await context.newCDPSession(page);
  let n = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    const file = `f${String(n++).padStart(6, '0')}.jpg`;
    writeFileSync(join(WORK, 'frames', file), Buffer.from(f.data, 'base64'));
    frames.push({ t: now(), file });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });

  // Line up so a spoken minute marker plays a few seconds after pressing Play.
  const wait = (await secondsToNextMarker('uk-rap')) - 5;
  if (wait > 0) { log(`aligning with next minute marker: waiting ${wait.toFixed(0)}s (not recorded)`); await sleep(wait * 1000); }

  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });
  const t0 = now();

  // 1. Intro
  await caption(page, 'Street Blackjack Radio - Stage 2 proof of concept',
    'Running on AzuraCast (local test server). Two 24/7 stations playing synthetic test mixes with a spoken marker every minute.');
  await sleep(5000);

  // 2. Radio ON -> UK Rap live
  await page.locator('#power').click();
  startRecording('uk_rap');
  await caption(page, '1. Radio ON - joins UK Rap at the LIVE point',
    'Not the start of the mix: the station has been broadcasting all along. Listen for "minute N".');
  await sleep(14000);
  log('uk-rap', await stationState(page));

  // 3. Switch station
  await clickStation(page, 'Afrobeats');
  startRecording('afrobeats');
  await caption(page, '2. Switching station', 'Afrobeats plays from ITS own live position - every station runs independently.');
  await sleep(12000);

  // 4. Back to UK Rap, then pause
  await clickStation(page, 'UK Rap');
  startRecording('uk_rap');
  await caption(page, '3. Back to UK Rap', 'Still live - UK Rap kept playing while we were on Afrobeats.');
  await sleep(7000);
  await page.locator('#playpause').click();
  stopRecording();
  const paused = await stationState(page);
  log('paused', paused);
  // Resume ~4 s before a minute marker so the jump is audible.
  const toMarker = await secondsToNextMarker('uk-rap');
  const away = 60 + toMarker - 4;
  await caption(page, `4. Paused at "${paused.meta.split('·').pop().trim()}" - leaving for ${Math.round(away)} seconds`,
    'Pause disconnects from the stream. Nobody is listening from this player, but the station keeps broadcasting. (sped up)');
  const awayFrom = now();
  await sleep(away * 1000 - 3000);
  speedups.push({ from: awayFrom + 2, to: now(), factor: 10 });

  // 5. Rejoin live
  await page.locator('#playpause').click();
  startRecording('uk_rap');
  await sleep(1500);
  const resumed = await stationState(page);
  log('resumed', resumed);
  await caption(page, `5. Play again - rejoined LIVE at "${resumed.meta.split('·').pop().trim()}"`,
    `Not where we left off (${paused.meta.split('·').pop().trim()}): it jumped ahead by the time we were away, exactly like a real radio.`);
  await sleep(12000);

  // 6. Server restart -> automatic recovery
  await caption(page, '6. Restarting the UK Rap station on the server...', 'Simulates a crash or maintenance restart while someone is listening.');
  await sleep(2500);
  stopRecording();
  wslScript('restart.sh', 'set -a; . /opt/sbradio/secrets/azuracast-api.env; set +a\ncurl -s -o /dev/null -X POST -H "X-API-Key: $AZURACAST_API_KEY" http://127.0.0.1:18080/api/station/1/restart\n');
  const restartAt = now();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const st = await stationState(page);
    if (now() - restartAt > 3 && st.status === 'Playing live') break;
  }
  startRecording('uk_rap');
  await caption(page, '6. ...the player reconnected by itself', 'No tap needed. (After a restart AzuraCast starts the next mix.)');
  await sleep(9000);

  // 7. Mute + station list states
  await page.locator('#mute').click();
  await caption(page, '7. Mute / unmute and volume', 'On iPhone, volume is set with the phone buttons (an iOS rule); mute works everywhere.');
  stopRecording();
  await sleep(3000);
  await page.locator('#mute').click();
  startRecording('uk_rap');
  await sleep(3000);
  await caption(page, '8. External and offline stations',
    'OnTop FM will appear like the "External Test" station (direct stream, not via our server). An offline station is greyed out and cannot break the player.');
  await page.locator('.station', { hasText: 'Offline Test' }).scrollIntoViewIfNeeded();
  await sleep(7000);
  await page.locator('#power').click();
  stopRecording();
  await caption(page, 'Radio OFF', '');
  await sleep(2000);

  // 8. Admin dashboard
  await page.goto(`${ADMIN}/login`);
  await page.waitForSelector('input[type=password]');
  await caption(page, '9. Admin dashboard (AzuraCast)', 'Upload mixes, playlists, schedules, adverts, listener counts. Only reachable from the server itself.');
  await page.locator('input[type=email], input[name=username]').first().fill(creds.AZURACAST_ADMIN_EMAIL);
  await page.locator('input[type=password]').first().fill(creds.AZURACAST_ADMIN_PASSWORD);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // Show the station list (below the welcome panels), clear of the caption bar.
  await page.getByText('Station Overview').first().evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 20 })).catch(() => {});
  await caption(page, '9. Admin dashboard (AzuraCast)', 'Both stations broadcasting 24/7, with live listener counts. Everything an admin needs is built in - no custom admin to maintain.');
  await sleep(8000);

  // 9. Registry API
  await page.goto(`${PLAYER}v1/stations`);
  await caption(page, '10. Station Registry API - what the game will use',
    'One list of all stations: name, genre, HTTPS stream URL, artwork, now playing, listeners, online status. No keys exposed.');
  await sleep(7000);
  await caption(page, 'Stage 2 complete', 'Next: Stage 3 - all five stations, schedules, adverts, OnTop FM, admin guide.');
  await sleep(4000);

  await cdp.send('Page.stopScreencast');
  stopRecording();
  await browser.close();
  const t1 = now();

  // ---------------------------------------------------------------- assemble
  log(`captured ${frames.length} frames, ${audio.length} audio segments; assembling`);
  const total = videoTime(t1, t0);
  // Video: each frame lasts until the next one (in video time).
  let concat = '';
  for (let i = 0; i < frames.length; i++) {
    const a = videoTime(frames[i].t, t0);
    const b = i + 1 < frames.length ? videoTime(frames[i + 1].t, t0) : total;
    concat += `file 'frames/${frames[i].file}'\nduration ${Math.max(0.001, b - a).toFixed(3)}\n`;
  }
  concat += `file 'frames/${frames[frames.length - 1].file}'\n`;
  writeFileSync(join(WORK, 'frames.txt'), concat);

  // Audio: place each recorded segment at its video time (segments never overlap the sped-up range).
  const inputs = [], filters = [];
  audio.forEach((s, i) => {
    if (!existsSync(join(WORK, s.file))) return;
    const start = Math.max(0, videoTime(s.from, t0));
    const dur = Math.max(0.1, s.to - s.from);
    inputs.push('-t', dur.toFixed(2), '-i', `${WORK_WSL}/${s.file}`);
    const idx = inputs.filter((x) => x === '-i').length; // 1-based (input 0 is the video)
    filters.push(`[${idx}:a]afade=t=in:d=0.3,afade=t=out:st=${Math.max(0, dur - 0.4).toFixed(2)}:d=0.4,adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)}[a${i}]`);
  });
  const labels = filters.map((f) => f.slice(f.lastIndexOf('[')));
  const filter = `${filters.join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,apad[aout]`;
  wslScript('assemble.sh', [
    'set -e',
    `cd ${WORK_WSL}`,
    `ffmpeg -nostdin -loglevel error -y -f concat -safe 0 -i frames.txt ${inputs.map((x) => `'${x}'`).join(' ')} ` +
      `-filter_complex '${filter};[0:v]fps=25,scale=${W}:-2:flags=lanczos,format=yuv420p[v]' -map '[v]' -map '[aout]' ` +
      `-t ${total.toFixed(2)} -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 160k -movflags +faststart demo.mp4`,
    '',
  ].join('\n'), { stdio: 'inherit' });
  rmSync(OUT, { force: true });
  execFileSync('cmd.exe', ['/c', 'copy', '/y', join(WORK, 'demo.mp4'), OUT], { stdio: 'ignore' });
  log(`done: ${OUT} (${total.toFixed(0)} s)`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  try { stopRecording(); } catch { /* ignore */ }
  process.exit(1);
});
