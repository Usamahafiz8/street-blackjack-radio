#!/usr/bin/env node
// Proves that stations keep broadcasting with NO listeners connected.
//
// It polls AzuraCast's PUBLIC Now Playing API (no key) for a while and checks that:
//   1. each station stays online,
//   2. the playhead keeps moving forward in step with real time,
//   3. when a mix ends, the next one starts straight away (no gap),
//   4. listener count was 0 (otherwise the test proves less, and it says so).
// It never connects to an audio stream itself, so it doesn't count as a listener.
//
// Works on any machine with Node 18+ (no dependencies):
//   node infra/scripts/check-continuous.mjs --base https://radio.example.com --minutes 30
// Options: --stations uk_rap,afrobeats  --interval 15  --out results.json
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const BASE = (args.base || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('usage: check-continuous.mjs --base https://radio.example.com [--minutes 30] [--interval 15] [--stations a,b] [--out file.json]');
  process.exit(2);
}
const MINUTES = Number(args.minutes || 30);
const INTERVAL_S = Number(args.interval || 15);
const TOLERANCE_S = 30;  // Now Playing data is refreshed every ~15 s by AzuraCast
const GAP_TOLERANCE_S = 20; // crossfade and processing between tracks

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hhmmss = (s) => new Date(s * 1000).toISOString().slice(11, 19);

async function sample() {
  const res = await fetch(`${BASE}/api/nowplaying`, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const t = Date.now() / 1000;
  const list = await res.json();
  return list.map((np) => ({
    t,
    station: np.station.shortcode,
    online: np.is_online,
    listeners: np.listeners?.current ?? null,
    sh_id: np.now_playing?.sh_id ?? null,
    title: np.now_playing?.song?.text || [np.now_playing?.song?.artist, np.now_playing?.song?.title].filter(Boolean).join(' - ') || null,
    played_at: np.now_playing?.played_at ?? null,
    duration: np.now_playing?.duration ?? null,
    elapsed: np.now_playing?.elapsed ?? null,
  }));
}

function analyse(samples) {
  const issues = [];
  const transitions = [];
  let maxListeners = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    maxListeners = Math.max(maxListeners, s.listeners || 0);
    if (!s.online) issues.push(`${hhmmss(s.t)} station offline`);
    if (s.played_at && s.elapsed != null) {
      const wallElapsed = s.t - s.played_at;
      if (Math.abs(wallElapsed - s.elapsed) > TOLERANCE_S) {
        issues.push(`${hhmmss(s.t)} reported position ${s.elapsed}s but wall clock says ${Math.round(wallElapsed)}s`);
      }
    }
    if (i === 0) continue;
    const p = samples[i - 1];
    if (s.sh_id === p.sh_id) {
      // Same item: position must have advanced roughly in step with time.
      const advanced = (s.elapsed ?? 0) - (p.elapsed ?? 0);
      const wall = s.t - p.t;
      if (wall >= 20 && advanced <= 0) issues.push(`${hhmmss(s.t)} playhead did not move for ${Math.round(wall)}s`);
    } else if (p.played_at && p.duration && s.played_at) {
      // New item: it should start when the previous one ended.
      const expected = p.played_at + p.duration;
      const gap = s.played_at - expected;
      transitions.push({ at: hhmmss(s.played_at), from: p.title, to: s.title, gap_s: Math.round(gap) });
      if (Math.abs(gap) > GAP_TOLERANCE_S && s.played_at - p.played_at < 3 * p.duration) {
        issues.push(`${hhmmss(s.t)} gap of ${Math.round(gap)}s between "${p.title}" and "${s.title}"`);
      }
    }
  }
  return { issues, transitions, maxListeners };
}

async function main() {
  const wanted = args.stations ? args.stations.split(',') : null;
  const end = Date.now() + MINUTES * 60_000;
  const byStation = {};
  console.log(`Polling ${BASE}/api/nowplaying every ${INTERVAL_S}s for ${MINUTES} min (no audio connection is made)\n`);
  while (Date.now() < end) {
    try {
      for (const s of await sample()) {
        if (wanted && !wanted.includes(s.station)) continue;
        (byStation[s.station] ||= []).push(s);
        console.log(`${hhmmss(s.t)}  ${s.station.padEnd(12)} ${s.online ? 'online ' : 'OFFLINE'}  listeners=${s.listeners}  ${String(s.elapsed).padStart(5)}s / ${s.duration}s  ${s.title}`);
      }
    } catch (err) {
      console.log(`${hhmmss(Date.now() / 1000)}  API error: ${err.message}`);
    }
    await sleep(INTERVAL_S * 1000);
  }

  let pass = true;
  const report = {};
  console.log('\n================ RESULT ================');
  for (const [station, samples] of Object.entries(byStation)) {
    const { issues, transitions, maxListeners } = analyse(samples);
    const ok = issues.length === 0 && samples.length > 2;
    pass &&= ok;
    report[station] = { pass: ok, samples: samples.length, transitions, issues, max_listeners_seen: maxListeners };
    console.log(`\n${station}: ${ok ? 'PASS' : 'FAIL'}  (${samples.length} samples, ${transitions.length} track change(s))`);
    for (const tr of transitions) console.log(`   ${tr.at}  "${tr.from}" -> "${tr.to}"  gap ${tr.gap_s}s`);
    for (const i of issues) console.log(`   ! ${i}`);
    console.log(maxListeners === 0
      ? '   Listeners: 0 for the whole run - the station advanced with nobody listening.'
      : `   Note: up to ${maxListeners} listener(s) were connected during the run; rerun with nobody listening for a clean proof.`);
    if (!transitions.length) console.log('   Note: no mix change observed; run longer than one mix length to see a transition.');
  }
  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ base: BASE, minutes: MINUTES, pass, report, samples: byStation }, null, 2));
    console.log(`\nSaved: ${args.out}`);
  }
  console.log(`\nOVERALL: ${pass ? 'PASS' : 'FAIL'}`);
  process.exit(pass ? 0 : 1);
}

main();
