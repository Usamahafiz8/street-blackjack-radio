import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/registry.js';

// After a restart AzuraCast reports is_online=false for a while although the stream is up.
// The registry must check the stream itself before telling players the station is offline.
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
let azura, registry, port;

before(async () => {
  azura = createServer((req, res) => {
    if (req.url === '/api/nowplaying') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const st = (code) => ({
        station: { id: code, name: code, shortcode: code, is_public: true,
          mounts: [{ url: `http://localhost:18080/listen/${code}/radio.mp3`, format: 'mp3', bitrate: 128, is_default: true }] },
        listeners: { current: 0, unique: 0 }, now_playing: null, is_online: false,
      });
      return res.end(JSON.stringify([{ ...st('streaming'), now_playing: { song: { title: 'Station Offline' }, playlist: '' } }, st('dead')]));
    }
    if (req.url === '/listen/streaming/radio.mp3') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.write(Buffer.alloc(2048, 1));
      return req.on('close', () => res.end());
    }
    res.writeHead(404);
    res.end();
  });
  port = await listen(azura);
  const dir = mkdtempSync(join(tmpdir(), 'sbr-off-'));
  writeFileSync(join(dir, 's.json'), JSON.stringify({ azuracast: { overrides: {} }, external: [] }));
  registry = new Registry(loadConfig({
    AZURACAST_INTERNAL_URL: `http://127.0.0.1:${port}`,
    AZURACAST_PUBLIC_URL: 'https://radio.example.com',
    AZURACAST_ALIAS_HOSTS: 'localhost:18080',
    STATIONS_CONFIG: join(dir, 's.json'),
  }));
  await registry.refreshAzuracast();
});

after(() => azura.close());

test('station reported offline but streaming is shown online; a dead one stays offline', () => {
  const by = Object.fromEntries(registry.list().stations.map((s) => [s.id, s]));
  assert.equal(by.streaming.online, true);
  assert.equal(by.dead.online, false);
  assert.equal(by.streaming.now_playing, null, 'placeholder title must not be shown');
  assert.equal(by.streaming.stream.url, 'https://radio.example.com/listen/streaming/radio.mp3');
});
