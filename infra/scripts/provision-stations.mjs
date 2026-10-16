#!/usr/bin/env node
// Creates / updates AzuraCast stations, uploads their media, builds playlists and sets
// the fallback file - all through AzuraCast's admin API. Safe to run repeatedly.
//
// Runs ON THE SERVER only. The admin API key is read from the environment and never leaves
// the server. It is not printed, and not used by the registry or the player.
//
//   sudo docker run --rm --network host --env-file /opt/sbradio/secrets/azuracast-api.env \
//     --env-file /opt/sbradio/config/sbradio.env \
//     -v /opt/sbradio/app/infra:/infra:ro -v /opt/sbradio/test-audio:/media:ro \
//     node:22-alpine node /infra/scripts/provision-stations.mjs /infra/stations.poc.json /media
//
// Env: AZURACAST_API_KEY (required), AZURACAST_URL (default http://127.0.0.1:8080),
//      RADIO_DOMAIN (VPS) or BASE_URL (local, e.g. http://localhost:18080)
import { readFile, readdir, stat } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const [configPath, mediaRoot] = process.argv.slice(2);
if (!configPath || !mediaRoot) {
  console.error('usage: provision-stations.mjs <stations.json> <media-root>');
  process.exit(2);
}
const BASE = (process.env.AZURACAST_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const KEY = process.env.AZURACAST_API_KEY;
if (!KEY) {
  console.error('AZURACAST_API_KEY is not set (expected in /opt/sbradio/secrets/azuracast-api.env).');
  process.exit(2);
}
const CHUNK = 5 * 1024 * 1024; // same chunk size as AzuraCast's own web uploader

const step = (msg) => console.log(`\n==> ${msg}`);
const info = (msg) => console.log(`    ${msg}`);

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'X-API-Key': KEY, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = json?.message || json?.formatted_message || text.slice(0, 300);
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${msg}`);
  }
  return json;
}

/** Chunked upload using the same "flow" protocol as AzuraCast's web uploader (handles multi-GB mixes). */
async function flowUpload(path, filePath, extraFields = {}) {
  const { size } = await stat(filePath);
  const blob = await openAsBlob(filePath, { type: 'audio/mpeg' });
  const name = basename(filePath);
  const identifier = `${size}-${name.replace(/[^A-Za-z0-9_-]/g, '')}-${randomUUID().slice(0, 8)}`;
  const total = Math.max(1, Math.ceil(size / CHUNK));
  let last = null;
  for (let n = 1; n <= total; n++) {
    const start = (n - 1) * CHUNK;
    const end = n === total ? size : start + CHUNK;
    const form = new FormData();
    const fields = {
      flowChunkNumber: n, flowChunkSize: CHUNK, flowCurrentChunkSize: end - start, flowTotalSize: size,
      flowIdentifier: identifier, flowFilename: name, flowRelativePath: name, flowTotalChunks: total, ...extraFields,
    };
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    form.append('file', blob.slice(start, end), name);
    const res = await fetch(`${BASE}/api${path}`, { method: 'POST', headers: { 'X-API-Key': KEY }, body: form });
    if (!res.ok) throw new Error(`upload ${name} chunk ${n}/${total} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    last = await res.text();
    if (total > 4) process.stdout.write(`\r    uploading ${name}: ${Math.round((n / total) * 100)}%   `);
  }
  if (total > 4) process.stdout.write('\n');
  try {
    const json = JSON.parse(last);
    if (json && json.success === false) throw new Error(json.message || 'upload rejected');
  } catch (e) {
    if (e instanceof SyntaxError) return; // empty body = OK
    throw e;
  }
}

async function main() {
  const conf = JSON.parse(await readFile(configPath, 'utf8'));
  const domain = process.env.RADIO_DOMAIN;

  step('System settings');
  const settings = {
    use_radio_proxy: true,      // streams served on 443 at /listen/..., no extra ports
    prefer_browser_url: false,  // always build URLs from base_url (the registry calls AzuraCast internally)
    always_use_ssl: false,      // Caddy already forces HTTPS; avoids redirect loops behind the proxy
    ip_source: 'xff',           // trust X-Forwarded-For from Caddy (real listener IPs)
  };
  // BASE_URL overrides (local WSL: http://localhost:18080); otherwise https://RADIO_DOMAIN on the VPS.
  if (process.env.BASE_URL) settings.base_url = process.env.BASE_URL;
  else if (domain) settings.base_url = `https://${domain}`;
  await api('PUT', '/admin/settings', settings);
  info(`base_url=${settings.base_url || '(unchanged)'}; web proxy for radio on; IP source X-Forwarded-For`);

  const existing = await api('GET', '/admin/stations');

  for (const def of conf.stations) {
    step(`Station: ${def.name} (${def.short_name})`);
    let station = existing.find((s) => s.short_name === def.short_name);
    const stationBody = {
      name: def.name,
      short_name: def.short_name,
      description: def.description || '',
      genre: def.genre || '',
      is_enabled: true,
      frontend_type: 'icecast',
      backend_type: 'liquidsoap',
      enable_public_page: true,
      enable_public_api: true,
      enable_requests: false,
      enable_on_demand: false,
      enable_streamers: false,
      enable_hls: true,
      timezone: conf.settings?.timezone || 'Europe/London',
    };
    if (!station) {
      station = await api('POST', '/admin/stations', stationBody);
      info(`created (id ${station.id})`);
    } else {
      await api('PUT', `/admin/station/${station.id}`, stationBody);
      info(`exists (id ${station.id}) - settings updated`);
    }
    const sid = station.id;

    // Default 128 kbps MP3 mount (AzuraCast normally creates it; make sure).
    const mounts = await api('GET', `/station/${sid}/mounts`);
    if (!mounts.length) {
      await api('POST', `/station/${sid}/mounts`, {
        name: '/radio.mp3', display_name: '128kbps MP3', is_default: true, is_public: true,
        is_visible_on_public_pages: true, enable_autodj: true, autodj_format: 'mp3', autodj_bitrate: 128,
      });
      info('created mount /radio.mp3 (MP3 128 kbps)');
    } else {
      info(`mounts: ${mounts.map((m) => `${m.name} (${m.autodj_format || '?'} ${m.autodj_bitrate || '?'}k)`).join(', ')}`);
    }

    // Media
    const dir = join(mediaRoot, def.media_dir);
    const localFiles = (await readdir(dir)).filter((f) => /\.(mp3|m4a|aac|ogg|flac|wav)$/i.test(f)).sort();
    let files = await api('GET', `/station/${sid}/files`);
    for (const f of localFiles) {
      if (files.some((m) => m.path === f)) { info(`media exists: ${f}`); continue; }
      await flowUpload(`/station/${sid}/files/upload`, join(dir, f));
      info(`uploaded: ${f}`);
    }
    files = await api('GET', `/station/${sid}/files`);

    // Playlists
    const playlists = await api('GET', `/station/${sid}/playlists`);
    for (const p of def.playlists) {
      let pl = playlists.find((x) => x.name === p.name);
      const body = {
        name: p.name, type: p.type || 'default', source: 'songs', order: p.order || 'shuffle',
        is_enabled: true, weight: p.weight ?? 3, include_in_requests: false, include_in_on_demand: false,
        avoid_duplicates: p.order !== 'sequential', is_jingle: Boolean(p.is_jingle),
        play_per_songs: p.play_per_songs ?? 0, play_per_minutes: p.play_per_minutes ?? 0,
      };
      if (!pl) {
        pl = await api('POST', `/station/${sid}/playlists`, body);
        info(`playlist created: ${p.name} (${body.order})`);
      } else {
        await api('PUT', `/station/${sid}/playlist/${pl.id}`, body);
        info(`playlist updated: ${p.name}`);
      }
      const members = files.filter((m) => localFiles.includes(m.path));
      for (const m of members) {
        const already = (m.playlists || []).some((x) => (x.id ?? x) === pl.id);
        if (!already) await api('PUT', `/station/${sid}/file/${m.id}`, { playlists: [pl.id] });
      }
      info(`${members.length} file(s) in "${p.name}"`);
    }

    // Disable AzuraCast's empty auto-created "default" playlist, if any, to keep things tidy.
    for (const pl of playlists) {
      if (pl.name === 'default' && pl.is_enabled && !def.playlists.some((p) => p.name === 'default')) {
        await api('PUT', `/station/${sid}/playlist/${pl.id}`, { ...pl, is_enabled: false });
        info('disabled auto-created "default" playlist');
      }
    }

    // Fallback file: plays if all playlists are ever empty/broken, so the stream is never silent.
    if (conf.fallback_file) {
      const fb = await api('GET', `/station/${sid}/fallback`).catch(() => null);
      if (!fb?.hasRecord) {
        await flowUpload(`/station/${sid}/fallback`, join(mediaRoot, conf.fallback_file));
        info('fallback file uploaded');
      } else {
        info('fallback file already set');
      }
    }

    step(`Restarting ${def.short_name} to apply configuration`);
    await api('POST', `/station/${sid}/restart`);
  }

  step('Public Now Playing check');
  await new Promise((r) => setTimeout(r, 15000));
  const np = await (await fetch(`${BASE}/api/nowplaying`)).json();
  for (const s of np) {
    info(`${s.station.shortcode}: online=${s.is_online} listen_url=${s.station.listen_url} now=${s.now_playing?.song?.text || '-'}`);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
