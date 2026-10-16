#!/usr/bin/env node
// Verifies advert breaks from AzuraCast's PUBLIC play history (no key, no audio connection):
//   - every station played at least one advert/promo during the run,
//   - each advert started when the previous item ended (a break), never in the middle of a mix.
//
//   node infra/scripts/check-ads.mjs --base http://localhost:18080 --minutes 30 [--out file.json]
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const BASE = (args.base || '').replace(/\/+$/, '');
if (!BASE) { console.error('usage: check-ads.mjs --base URL [--minutes 30] [--out file.json]'); process.exit(2); }
const MINUTES = Number(args.minutes || 30);
const AD = /^(ads?|promo)\b/i;
const TOL = 20; // seconds: crossfade + timing granularity
const hhmmss = (s) => new Date(s * 1000).toISOString().slice(11, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const items = {}; // station -> Map(sh_id -> item)
const add = (st, h) => {
  if (!h?.sh_id) return;
  (items[st] ||= new Map()).set(h.sh_id, {
    sh_id: h.sh_id, played_at: h.played_at, duration: h.duration, playlist: h.playlist || '',
    title: h.song?.title || h.song?.text || '',
  });
};

const end = Date.now() + MINUTES * 60_000;
console.log(`Watching ${BASE} play history for ${MINUTES} min...`);
while (Date.now() < end) {
  try {
    const list = await (await fetch(`${BASE}/api/nowplaying`, { signal: AbortSignal.timeout(10000) })).json();
    for (const np of list) {
      add(np.station.shortcode, np.now_playing);
      for (const h of np.song_history || []) add(np.station.shortcode, h);
    }
  } catch (e) { console.log('API error', e.message); }
  await sleep(30_000);
}

let pass = true;
const report = {};
for (const [st, map] of Object.entries(items)) {
  const seq = [...map.values()].sort((a, b) => a.played_at - b.played_at);
  const issues = [];
  let ads = 0;
  console.log(`\n${st}`);
  seq.forEach((it, i) => {
    const prev = seq[i - 1];
    const isAd = AD.test(it.playlist);
    let note = '';
    if (prev && prev.duration) {
      const gap = it.played_at - (prev.played_at + prev.duration);
      note = `starts ${gap >= 0 ? '+' : ''}${Math.round(gap)}s after previous item ended`;
      if (isAd && Math.abs(gap) > TOL) issues.push(`advert at ${hhmmss(it.played_at)} did not start at a break (${Math.round(gap)}s)`);
    }
    if (isAd) ads++;
    console.log(`  ${hhmmss(it.played_at)}  ${isAd ? 'AD  ' : 'MIX '} ${it.title.padEnd(42).slice(0, 42)} [${it.playlist}] ${Math.round(it.duration)}s  ${note}`);
  });
  if (!ads) issues.push('no advert played during the run');
  issues.forEach((x) => console.log(`  ! ${x}`));
  const ok = issues.length === 0;
  pass &&= ok;
  report[st] = { pass: ok, ad_breaks: ads, items: seq, issues };
  console.log(`  => ${ok ? 'PASS' : 'FAIL'} (${ads} advert(s))`);
}
if (args.out) writeFileSync(args.out, JSON.stringify({ base: BASE, minutes: MINUTES, pass, report }, null, 2));
console.log(`\nOVERALL: ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
