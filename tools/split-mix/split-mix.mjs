#!/usr/bin/env node
// Splits a long DJ mix into ~30-minute parts at natural transitions, so AzuraCast can play
// adverts BETWEEN parts instead of cutting into the music. The original file is never changed.
//
// Needs ffmpeg + ffprobe on the PATH (the radio server has them).
//
//   node split-mix.mjs "Friday Mix.mp3"                     auto: ~30 min parts at quiet transitions
//   node split-mix.mjs mix.mp3 --target 25 --window 5       ~25 min parts, search +/-5 min for a transition
//   node split-mix.mjs mix.mp3 --at 31:20,1:02:05,1:33:40   exact cut times (from the DJ's tracklist)
//   node split-mix.mjs mix.mp3 --out ./parts --dry-run      show the plan only
//
// Output: "<name> - Part 01.mp3", ... plus "<name>.split.json" describing the cuts.
// Audio is copied, not re-encoded, so quality is unchanged and splitting takes seconds.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const VALUE_FLAGS = ['--target', '--window', '--at', '--out'];
const input = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.includes(argv[i - 1])));
if (!input) {
  console.error('usage: split-mix.mjs <mix.mp3> [--target 30] [--window 4] [--at mm:ss,h:mm:ss] [--out dir] [--dry-run]');
  process.exit(2);
}
const TARGET = Number(opt('target', 30)) * 60;
const WINDOW = Number(opt('window', 4)) * 60;
const MIN_LAST = 0.4 * TARGET; // never leave a tiny last part
const outDir = opt('out', dirname(input));
const dryRun = argv.includes('--dry-run');

const fmt = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};
const parseTime = (t) => t.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:format_tags=title,artist,genre', '-of', 'json', file], { encoding: 'utf8' });
  const f = JSON.parse(out).format;
  return { duration: Number(f.duration), tags: f.tags || {} };
}

// Quiet moments (candidate transitions), loosening the threshold until some are found.
function quietPoints(file) {
  for (const db of [-50, -42, -36, -30]) {
    // silencedetect reports on stderr
    const log = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-i', file, '-af', `silencedetect=n=${db}dB:d=0.3`, '-vn', '-f', 'null', '-'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stderr || '';
    const points = [];
    let start = null;
    for (const line of log.split('\n')) {
      const s = line.match(/silence_start: ([\d.]+)/);
      const e = line.match(/silence_end: ([\d.]+)/);
      if (s) start = Number(s[1]);
      if (e && start != null) { points.push({ at: (start + Number(e[1])) / 2, threshold: db }); start = null; }
    }
    if (points.length) return points;
  }
  return [];
}

function planCuts(duration, quiet) {
  const cuts = [];
  let last = 0;
  for (let target = TARGET; target < duration - MIN_LAST; target = last + TARGET) {
    const candidates = quiet.filter((q) => Math.abs(q.at - target) <= WINDOW && q.at - last >= TARGET / 2 && duration - q.at >= MIN_LAST);
    candidates.sort((a, b) => Math.abs(a.at - target) - Math.abs(b.at - target));
    const pick = candidates[0];
    const at = pick ? pick.at : target;
    cuts.push({ at, method: pick ? `quiet transition (${pick.threshold} dB)` : 'exact target time - no transition found nearby, check this cut' });
    last = at;
  }
  return cuts;
}

function main() {
  const { duration, tags } = probe(input);
  const ext = extname(input) || '.mp3';
  const name = basename(input, ext);
  console.log(`Mix: ${basename(input)}  (${fmt(duration)})`);

  let cuts;
  if (opt('at')) {
    cuts = opt('at').split(',').map((t) => ({ at: parseTime(t.trim()), method: 'given time' })).filter((c) => c.at > 0 && c.at < duration).sort((a, b) => a.at - b.at);
  } else {
    const quiet = quietPoints(input);
    console.log(`Found ${quiet.length} quiet moment(s) to consider as transitions.`);
    cuts = planCuts(duration, quiet);
  }
  if (!cuts.length) {
    console.log('Mix is short enough - no split needed.');
    return;
  }

  const bounds = [0, ...cuts.map((c) => c.at), duration];
  const parts = bounds.slice(0, -1).map((from, i) => ({ part: i + 1, from, to: bounds[i + 1] }));
  const total = parts.length;
  console.log(`Plan: ${total} parts`);
  for (const p of parts) {
    const cut = cuts[p.part - 1];
    console.log(`  Part ${String(p.part).padStart(2, '0')}: ${fmt(p.from)} - ${fmt(p.to)}  (${fmt(p.to - p.from)})${cut ? `   cut: ${cut.method}` : ''}`);
  }
  if (dryRun) return;

  mkdirSync(outDir, { recursive: true });
  const title = tags.title || name;
  const files = [];
  for (const p of parts) {
    const file = join(outDir, `${name} - Part ${String(p.part).padStart(2, '0')}${ext}`);
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-ss', p.from.toFixed(3), '-to', p.to.toFixed(3), '-i', input,
      '-map', '0:a', '-c', 'copy', '-map_metadata', '0',
      '-metadata', `title=${title} (Part ${p.part} of ${total})`, '-metadata', `track=${p.part}/${total}`, file]);
    files.push(basename(file));
  }
  const manifest = { source: basename(input), duration_s: duration, target_min: TARGET / 60, parts: parts.map((p, i) => ({ ...p, file: files[i], cut_method: cuts[i]?.method || 'end of mix' })) };
  writeFileSync(join(outDir, `${name}.split.json`), JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${total} parts to ${outDir}. Upload the parts (not the original) and keep them in order in a SEQUENTIAL playlist.`);
}

try {
  main();
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
}
