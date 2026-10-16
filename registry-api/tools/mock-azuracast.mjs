// DEVELOPMENT ONLY: imitates AzuraCast's public /api/nowplaying AND serves endless
// "live" audio streams, so the registry and player can be developed without a server.
//
// Each fake station plays 12-minute "mixes" back to back, derived from the wall clock,
// exactly like a real 24/7 station: whoever connects hears the CURRENT position.
// The tone pitch rises each minute of the mix, and N beeps at the start of each minute
// mark minute N, so you can hear where in the mix you are.
//
//   node tools/mock-azuracast.mjs          (listens on :8081)
//   Registry: AZURACAST_INTERNAL_URL=AZURACAST_PUBLIC_URL=http://localhost:8081
//
//   GET /api/nowplaying
//   GET /listen/<shortcode>/radio.wav      endless WAV stream
//   GET /admin/kill/<shortcode>?s=20       simulate a 20 s outage of that stream (for reconnect tests)
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8081);
const BASE = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const MIX_S = Number(process.env.MIX_S || 720);
const EPOCH = Date.UTC(2026, 0, 1) / 1000;
const RATE = 22050;

const stations = [
  { id: 1, shortcode: 'uk_rap', name: 'UK Rap (mock)', baseHz: 220 },
  { id: 2, shortcode: 'afrobeats', name: 'Afrobeats (mock)', baseHz: 330 },
];
const downUntil = new Map();
const listeners = new Map(stations.map((s) => [s.shortcode, 0]));

function position(now = Date.now() / 1000) {
  const n = Math.floor((now - EPOCH) / MIX_S);
  return { n, playedAt: EPOCH + n * MIX_S, elapsed: now - (EPOCH + n * MIX_S) };
}

function np(st) {
  const { n, playedAt, elapsed } = position();
  const isDown = (downUntil.get(st.shortcode) || 0) > Date.now();
  const url = `${BASE}/listen/${st.shortcode}/radio.wav`;
  return {
    station: {
      id: st.id, name: st.name, shortcode: st.shortcode, is_public: true,
      listen_url: url, mounts: [{ url, format: 'wav', bitrate: 352, is_default: true }],
      hls_enabled: false, hls_url: null,
    },
    listeners: { current: listeners.get(st.shortcode), unique: listeners.get(st.shortcode), total: listeners.get(st.shortcode) },
    now_playing: {
      sh_id: n, played_at: Math.floor(playedAt), duration: MIX_S, playlist: 'Rotation',
      song: { title: `Test Mix ${(n % 4) + 1}`, artist: `${st.name} DJ`, art: null },
      elapsed: Math.floor(elapsed), remaining: Math.ceil(MIX_S - elapsed),
    },
    is_online: !isDown,
  };
}

function wavHeader() {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(0xffffffff, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(0xffffffff, 40);
  return h;
}

// Sample value for station st at absolute time t (seconds since epoch).
function sampleAt(st, t) {
  const into = (t - EPOCH) % MIX_S;
  const minute = Math.floor(into / 60);
  const inMinute = into - minute * 60;
  const beeps = minute + 1;
  if (inMinute < beeps * 0.3) {
    return (inMinute % 0.3) < 0.15 ? 0.5 * Math.sin(2 * Math.PI * 1000 * t) : 0;
  }
  const hz = st.baseHz * Math.pow(2, minute / 12);
  const pulse = 0.6 + 0.4 * Math.sin(2 * Math.PI * 2 * t); // gentle "beat"
  return 0.25 * pulse * Math.sin(2 * Math.PI * hz * t);
}

function stream(st, req, res) {
  if ((downUntil.get(st.shortcode) || 0) > Date.now()) {
    res.writeHead(503);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.write(wavHeader());
  listeners.set(st.shortcode, listeners.get(st.shortcode) + 1);
  let t = Date.now() / 1000; // start at the LIVE position
  const tick = () => {
    if ((downUntil.get(st.shortcode) || 0) > Date.now()) return res.destroy(); // simulated drop
    const until = Date.now() / 1000 + 0.5; // keep ~0.5 s ahead of real time
    const n = Math.max(0, Math.floor((until - t) * RATE));
    if (n) {
      const buf = Buffer.alloc(n * 2);
      for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(sampleAt(st, t + i / RATE) * 32767), i * 2);
      t += n / RATE;
      res.write(buf);
    }
  };
  tick();
  const iv = setInterval(tick, 100);
  const done = () => { clearInterval(iv); listeners.set(st.shortcode, Math.max(0, listeners.get(st.shortcode) - 1)); };
  res.on('close', done);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/nowplaying') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(stations.map(np)));
  }
  let m = url.pathname.match(/^\/listen\/([a-z_]+)\/radio\.wav$/);
  if (m) {
    const st = stations.find((s) => s.shortcode === m[1]);
    if (st) return stream(st, req, res);
  }
  m = url.pathname.match(/^\/admin\/kill\/([a-z_]+)$/);
  if (m) {
    const s = Number(url.searchParams.get('s') || 20);
    downUntil.set(m[1], Date.now() + s * 1000);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(`${m[1]} down for ${s}s\n`);
  }
  res.writeHead(404);
  res.end();
}).listen(PORT, () => console.log(`mock AzuraCast on ${BASE}`));
