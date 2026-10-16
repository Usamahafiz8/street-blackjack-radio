#!/usr/bin/env node
// Simple listener load test: opens N simultaneous stream connections spread over the stations,
// keeps them for D seconds, then reports how many got audio at full real-time rate.
//   node load-test.mjs --base http://127.0.0.1:18080 --listeners 300 --seconds 60
// Run it ON the radio server (or next to it); otherwise you are testing your own internet line.
import http from 'node:http';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const BASE = new URL(args.base || 'http://127.0.0.1:18080');
const N = Number(args.listeners || 100);
const SECONDS = Number(args.seconds || 60);
const STATIONS = (args.stations || 'uk_rap,afrobeats,dancehall,rnb,oldschool').split(',');
const EXPECTED = 16000; // bytes/s at 128 kbps

const conns = [];
const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });

function open(i) {
  const st = STATIONS[i % STATIONS.length];
  const c = { st, bytes: 0, firstByteAt: null, error: null, startedAt: Date.now() };
  const req = http.get({ host: BASE.hostname, port: BASE.port, path: `/listen/${st}/radio.mp3?lt=${i}`, agent }, (res) => {
    if (res.statusCode !== 200) { c.error = `HTTP ${res.statusCode}`; res.resume(); return; }
    res.on('data', (d) => { if (!c.firstByteAt) c.firstByteAt = Date.now(); c.bytes += d.length; c.lastAt = Date.now(); });
    res.on('error', (e) => { c.error = e.code || e.message; });
  });
  req.on('error', (e) => { c.error = e.code || e.message; });
  c.req = req;
  conns.push(c);
}

console.log(`Opening ${N} listeners over ${STATIONS.length} stations...`);
for (let i = 0; i < N; i++) { open(i); if (i % 25 === 24) await new Promise((r) => setTimeout(r, 200)); }
const t0 = Date.now();
await new Promise((r) => setTimeout(r, 10_000)); // let the initial burst pass
const base = conns.map((c) => c.bytes);
const tA = Date.now();
await new Promise((r) => setTimeout(r, (SECONDS - 10) * 1000));
const tB = Date.now();
const rates = conns.map((c, i) => (c.bytes - base[i]) / ((tB - tA) / 1000));
for (const c of conns) c.req.destroy();

const ok = rates.filter((r) => r >= EXPECTED * 0.97).length;
const errors = conns.filter((c) => c.error).length;
const sorted = [...rates].sort((a, b) => a - b);
const kbps = (r) => (r * 8 / 1000).toFixed(1);
console.log(`\nListeners: ${N}  measured over ${((tB - tA) / 1000).toFixed(0)} s (after a 10 s warm-up)`);
console.log(`Full real-time rate (>= 97% of 128 kbps): ${ok}/${N}`);
console.log(`Errors / dropped: ${errors}`);
console.log(`Per-listener rate: min ${kbps(sorted[0])} kbps, median ${kbps(sorted[Math.floor(N / 2)])} kbps, max ${kbps(sorted[N - 1])} kbps`);
console.log(`Total outbound: ${(rates.reduce((a, b) => a + b, 0) * 8 / 1e6).toFixed(1)} Mbit/s`);
console.log(ok === N && !errors ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(0);
