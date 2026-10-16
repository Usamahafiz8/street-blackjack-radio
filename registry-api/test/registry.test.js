import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Registry } from '../src/registry.js';
import { createApp, originAllowed } from '../src/http.js';
import { makePublicUrl } from '../src/azuracast.js';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const close = (srv) => new Promise((r) => srv.close(() => r()));

const nowSec = Math.floor(Date.now() / 1000);
let azuraUp = true;
let azura, stream, notAudio, app;
let azuraPort, streamPort, notAudioPort, appPort;
let registry;

function npFixture(port) {
  const internal = `http://127.0.0.1:${port}`;
  return [
    {
      station: {
        id: 1,
        name: 'UK Rap',
        shortcode: 'uk_rap',
        is_public: true,
        listen_url: `${internal}/listen/uk_rap/radio.mp3`,
        mounts: [{ url: `${internal}/listen/uk_rap/radio.mp3`, format: 'mp3', bitrate: 128, is_default: true }],
        hls_enabled: true,
        hls_url: `${internal}/hls/uk_rap/live.m3u8`,
      },
      listeners: { current: 0, unique: 0, total: 0 },
      now_playing: {
        played_at: nowSec - 120,
        duration: 720,
        playlist: 'Rotation',
        song: { title: 'Test Mix 1', artist: 'SBR Test', text: 'SBR Test - Test Mix 1', art: `${internal}/static/img/generic_song.jpg` },
      },
      is_online: true,
    },
    {
      station: { id: 2, name: 'Afrobeats', shortcode: 'afrobeats', is_public: true, mounts: [], listen_url: `${internal}/listen/afrobeats/radio.mp3`, hls_enabled: false },
      listeners: { current: 3, unique: 2 },
      now_playing: { played_at: nowSec - 10, duration: 15, playlist: 'Ads - Sponsor', song: { title: 'Buy stuff', artist: 'Sponsor' } },
      is_online: true,
    },
    { station: { id: 3, name: 'Private', shortcode: 'private_one', is_public: false, mounts: [] }, is_online: true },
  ];
}

before(async () => {
  azura = createServer((req, res) => {
    if (!azuraUp) {
      res.writeHead(502);
      return res.end();
    }
    if (req.url === '/api/nowplaying') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(npFixture(azuraPort)));
    }
    res.writeHead(404);
    res.end();
  });
  stream = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    const iv = setInterval(() => res.write(Buffer.alloc(1024, 1)), 50);
    res.write(Buffer.alloc(1024, 1));
    req.on('close', () => clearInterval(iv));
  });
  notAudio = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>alert</html>');
  });
  [azuraPort, streamPort, notAudioPort] = await Promise.all([listen(azura), listen(stream), listen(notAudio)]);

  const dir = mkdtempSync(join(tmpdir(), 'sbr-'));
  const stationsConfigPath = join(dir, 'stations.config.json');
  writeFileSync(
    stationsConfigPath,
    JSON.stringify({
      azuracast: {
        hide_playlists_matching: ['^ads?\\b', 'advert'],
        overrides: { uk_rap: { id: 'uk-rap', name: 'UK Rap / Drill / Grime', genre: 'UK Rap', order: 10, artwork: 'uk-rap.svg' } },
      },
      external: [
        { id: 'ext-ok', name: 'External OK', stream_url: `http://127.0.0.1:${streamPort}/live`, order: 50 },
        { id: 'ext-html', name: 'External HTML', stream_url: `http://127.0.0.1:${notAudioPort}/x`, order: 51 },
        { id: 'ext-down', name: 'External Down', stream_url: 'http://127.0.0.1:1/none', order: 52 },
        { id: 'ext-disabled', name: 'Disabled', enabled: false, stream_url: 'https://example.com/s' },
      ],
    }),
  );

  const cfg = {
    azuracastInternalUrl: `http://127.0.0.1:${azuraPort}`,
    azuracastPublicUrl: 'https://radio.example.com',
    publicBaseUrl: 'https://api.radio.example.com',
    pollIntervalMs: 60_000,
    externalCheckIntervalMs: 60_000,
    requestTimeoutMs: 2_000,
    corsOrigins: ['https://game.example.com', 'https://*.streetblackjack.test'],
    allowInsecureStreams: true, // local test servers are plain http
    stationsConfigPath,
    artDir: new URL('../art/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    stateDir: '',
  };
  registry = new Registry(cfg);
  await registry.start();
  app = createApp(registry, cfg);
  appPort = await listen(app);
});

after(async () => {
  registry.stop();
  await Promise.all([close(app), close(azura), close(stream), close(notAudio)]);
});

const get = (path, headers = {}) => fetch(`http://127.0.0.1:${appPort}${path}`, { headers });

test('merges AzuraCast and external stations in order, hiding private/disabled ones', async () => {
  const res = await get('/v1/stations');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(
    body.stations.map((s) => s.id),
    ['uk-rap', 'ext-ok', 'ext-html', 'ext-down', 'afrobeats'],
  );
});

test('AzuraCast station uses public HTTPS URLs and computes elapsed time', async () => {
  const s = await (await get('/v1/stations/uk-rap')).json();
  assert.equal(s.type, 'azuracast');
  assert.equal(s.name, 'UK Rap / Drill / Grime');
  assert.equal(s.stream.url, 'https://radio.example.com/listen/uk_rap/radio.mp3');
  assert.equal(s.hls_url, 'https://radio.example.com/hls/uk_rap/live.m3u8');
  assert.equal(s.artwork_url, 'https://api.radio.example.com/art/uk-rap.svg');
  assert.equal(s.online, true);
  assert.deepEqual(s.listeners, { current: 0, unique: 0 });
  assert.equal(s.now_playing.title, 'Test Mix 1');
  assert.ok(s.now_playing.elapsed_s >= 119 && s.now_playing.elapsed_s <= 125, `elapsed ${s.now_playing.elapsed_s}`);
  assert.equal(s.now_playing.duration_s, 720);
  assert.ok(!('azuracast_shortcode' in s) && !('order' in s));
});

test('advert playlists are reported as an ad break without titles', async () => {
  const s = await (await get('/v1/stations/afrobeats')).json();
  assert.equal(s.now_playing.is_ad_break, true);
  assert.equal(s.now_playing.title, null);
  assert.equal(s.now_playing.programme, null);
  assert.equal(s.stream.url, 'https://radio.example.com/listen/afrobeats/radio.mp3');
});

test('external stations: online, wrong content type, and unreachable', async () => {
  const { stations } = await (await get('/v1/stations')).json();
  const by = Object.fromEntries(stations.map((s) => [s.id, s]));
  assert.equal(by['ext-ok'].online, true);
  assert.equal(by['ext-ok'].type, 'external');
  assert.equal(by['ext-html'].online, false);
  assert.equal(by['ext-html'].status_reason, 'not_audio');
  assert.equal(by['ext-down'].online, false);
  assert.equal(by['ext-down'].status, 'offline');
});

test('CORS: allowed origin, wildcard subdomain, and rejected origin', async () => {
  let res = await get('/v1/stations', { Origin: 'https://game.example.com' });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://game.example.com');
  res = await get('/v1/stations', { Origin: 'https://play.streetblackjack.test' });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://play.streetblackjack.test');
  res = await get('/v1/stations', { Origin: 'https://evil.example.net' });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(`http://127.0.0.1:${appPort}/v1/stations`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://game.example.com', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /GET/);
});

test('read-only: other methods are rejected', async () => {
  const res = await fetch(`http://127.0.0.1:${appPort}/v1/stations`, { method: 'POST' });
  assert.equal(res.status, 405);
});

test('serves artwork and 404s unknown stations', async () => {
  const art = await get('/art/uk-rap.svg');
  assert.equal(art.status, 200);
  assert.equal(art.headers.get('content-type'), 'image/svg+xml');
  assert.equal((await get('/v1/stations/nope')).status, 404);
  assert.equal((await get('/art/../package.json')).status, 404);
});

test('AzuraCast outage: stations stay listed but are marked offline', async () => {
  azuraUp = false;
  await registry.refreshAzuracast();
  const { stations } = await (await get('/v1/stations')).json();
  const uk = stations.find((s) => s.id === 'uk-rap');
  assert.equal(uk.online, false);
  assert.equal(uk.status_reason, 'azuracast_unreachable');
  const health = await (await get('/health')).json();
  assert.equal(health.azuracast.reachable, false);
  azuraUp = true;
  await registry.refreshAzuracast();
  assert.equal((await (await get('/v1/stations/uk-rap')).json()).online, true);
});

test('insecure http external streams are rejected unless explicitly allowed', async () => {
  const { checkStream } = await import('../src/external.js');
  const r = await checkStream(`http://127.0.0.1:${streamPort}/live`, { timeoutMs: 1000 });
  assert.deepEqual(r, { online: false, reason: 'insecure_http_stream' });
});

test('helpers', () => {
  const pub = makePublicUrl({ internalUrl: 'http://host.docker.internal:8080', publicUrl: 'https://radio.example.com' });
  assert.equal(pub('http://host.docker.internal:8080/listen/a/radio.mp3'), 'https://radio.example.com/listen/a/radio.mp3');
  assert.equal(pub('http://radio.example.com/listen/a/radio.mp3'), 'https://radio.example.com/listen/a/radio.mp3');
  assert.equal(pub('/api/station/1/art/x.jpg'), 'https://radio.example.com/api/station/1/art/x.jpg');
  assert.equal(originAllowed('https://a.b.example.com', ['https://*.example.com']), true);
  assert.equal(originAllowed('http://a.example.com', ['https://*.example.com']), false);
  assert.equal(originAllowed('https://example.com.evil.net', ['https://*.example.com']), false);
});
