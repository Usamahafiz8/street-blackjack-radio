import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/registry.js';
import { createApp } from '../src/http.js';

// "auto" mode (local development): stream/art URLs follow the origin each client used.
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
let azura, app, registry, appPort;

before(async () => {
  azura = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{
      station: {
        id: 1, name: 'UK Rap', shortcode: 'uk_rap', is_public: true,
        // AzuraCast builds URLs from its base_url (here localhost:18080), not from the internal address
        listen_url: 'http://localhost:18080/listen/uk_rap/radio.mp3',
        mounts: [{ url: 'http://localhost:18080/listen/uk_rap/radio.mp3', format: 'mp3', bitrate: 128, is_default: true }],
        hls_enabled: true, hls_url: 'http://localhost:18080/hls/uk_rap/live.m3u8',
      },
      listeners: { current: 0, unique: 0 },
      now_playing: null,
      is_online: true,
    }]));
  });
  const azPort = await listen(azura);
  const dir = mkdtempSync(join(tmpdir(), 'sbr-auto-'));
  writeFileSync(join(dir, 'stations.json'), JSON.stringify({
    azuracast: { overrides: { uk_rap: { id: 'uk-rap', artwork: 'uk-rap.svg' } } },
    external: [],
  }));
  const cfg = loadConfig({
    AZURACAST_INTERNAL_URL: `http://127.0.0.1:${azPort}`,
    AZURACAST_PUBLIC_URL: 'auto',
    PUBLIC_BASE_URL: 'auto',
    AZURACAST_ALIAS_HOSTS: 'localhost:18080',
    TRUST_PROXY_HEADERS: 'true',
    CORS_ORIGINS: '*',
    STATIONS_CONFIG: join(dir, 'stations.json'),
  });
  registry = new Registry(cfg);
  await registry.start();
  app = createApp(registry, cfg);
  appPort = await listen(app);
});

after(() => {
  registry.stop();
  app.close();
  azura.close();
});

const station = async (headers) =>
  (await fetch(`http://127.0.0.1:${appPort}/v1/stations/uk-rap`, { headers })).json();

test('URLs follow the forwarded HTTPS tunnel origin', async () => {
  const s = await station({ 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'abc-def.trycloudflare.com' });
  assert.equal(s.stream.url, 'https://abc-def.trycloudflare.com/listen/uk_rap/radio.mp3');
  assert.equal(s.hls_url, 'https://abc-def.trycloudflare.com/hls/uk_rap/live.m3u8');
  assert.equal(s.artwork_url, 'https://abc-def.trycloudflare.com/art/uk-rap.svg');
});

test('URLs follow a LAN address over plain HTTP', async () => {
  const s = await station({ 'X-Forwarded-Host': '192.168.1.20:8088' });
  assert.equal(s.stream.url, 'http://192.168.1.20:8088/listen/uk_rap/radio.mp3');
});

test('malformed forwarded host falls back safely', async () => {
  const s = await station({ 'X-Forwarded-Host': 'evil.com/"><script>' });
  assert.equal(s.stream.url, 'http://localhost/listen/uk_rap/radio.mp3');
});
