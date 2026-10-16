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
  const current = await api('GET', '/admin/settings');
  if (!current?.setup_complete_time) settings.setup_complete_time = Math.floor(Date.now() / 1000); // finish the first-run wizard
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
      // AzuraCast's default mount is 192 kbps; we standardise on 128 kbps MP3 (bandwidth plan, Stage 1 §3.3).
      for (const m of mounts) {
        if (m.is_default && (m.autodj_format !== 'mp3' || m.autodj_bitrate !== 128)) {
          await api('PUT', `/station/${sid}/mount/${m.id}`, { autodj_format: 'mp3', autodj_bitrate: 128, display_name: '128kbps MP3' });
          info(`default mount ${m.name} set to MP3 128 kbps (was ${m.autodj_format} ${m.autodj_bitrate}k)`);
        } else {
          info(`mount: ${m.name} (${m.autodj_format} ${m.autodj_bitrate}k)`);
        }
      }
    }

    // Media: each playlist names its files, either a whole folder (source_dir) or a list
    // (files, paths relative to the media root). dest = folder inside the station (e.g. "ads").
    const isAudio = (f) => /\.(mp3|m4a|aac|ogg|flac|wav)$/i.test(f);
    const plFiles = new Map(); // playlist name -> [{ local, remote }]
    for (const p of def.playlists) {
      const list = [];
      if (p.source_dir) {
        for (const f of (await readdir(join(mediaRoot, p.source_dir))).filter(isAudio).sort()) {
          list.push({ local: join(mediaRoot, p.source_dir, f), remote: p.dest ? `${p.dest}/${f}` : f });
        }
      }
      for (const rel of p.files || []) {
        const f = rel.split('/').pop();
        list.push({ local: join(mediaRoot, rel), remote: p.dest ? `${p.dest}/${f}` : f });
      }
      plFiles.set(p.name, list);
    }
    let files = await api('GET', `/station/${sid}/files`);
    const uploaded = new Set(files.map((m) => m.path));
    for (const { local, remote } of [...plFiles.values()].flat()) {
      if (uploaded.has(remote)) continue;
      const folder = remote.includes('/') ? remote.slice(0, remote.lastIndexOf('/')) : '';
      await flowUpload(`/station/${sid}/files/upload`, local, folder ? { currentDirectory: folder } : {});
      uploaded.add(remote);
      info(`uploaded: ${remote}`);
    }
    files = await api('GET', `/station/${sid}/files`);

    // Playlists
    const playlists = await api('GET', `/station/${sid}/playlists`);
    const wanted = new Map(); // media id -> Set(playlist ids)
    for (const p of def.playlists) {
      let pl = playlists.find((x) => x.name === p.name);
      const body = {
        name: p.name, type: p.type || 'default', source: 'songs', order: p.order || 'shuffle',
        is_enabled: true, weight: p.weight ?? 3, include_in_requests: false, include_in_on_demand: false,
        avoid_duplicates: p.order !== 'sequential', is_jingle: Boolean(p.is_jingle),
        play_per_songs: p.play_per_songs ?? 0, play_per_minutes: p.play_per_minutes ?? 0,
        schedule_items: (p.schedule || []).map((s) => ({
          start_time: s.start_time, end_time: s.end_time, days: s.days || [],
          start_date: s.start_date || null, end_date: s.end_date || null, loop_once: Boolean(s.loop_once),
        })),
      };
      if (!pl) {
        pl = await api('POST', `/station/${sid}/playlists`, body);
        info(`playlist created: ${p.name} (${body.type}, ${body.order}${body.play_per_songs ? `, every ${body.play_per_songs} song(s)` : ''}${body.play_per_minutes ? `, every ${body.play_per_minutes} min` : ''}${body.schedule_items.length ? ', scheduled' : ''})`);
      } else {
        await api('PUT', `/station/${sid}/playlist/${pl.id}`, body);
        info(`playlist updated: ${p.name}`);
      }
      for (const { remote } of plFiles.get(p.name)) {
        const m = files.find((x) => x.path === remote);
        if (!m) throw new Error(`uploaded file not found in AzuraCast: ${remote}`);
        if (!wanted.has(m.id)) wanted.set(m.id, new Set());
        wanted.get(m.id).add(pl.id);
      }
      info(`${plFiles.get(p.name).length} file(s) in "${p.name}"`);
    }
    // Assign each file to ALL its playlists in one update (an update replaces the file's playlist list).
    for (const [mediaId, ids] of wanted) {
      const m = files.find((x) => x.id === mediaId);
      const current = new Set((m.playlists || []).map((x) => x.id ?? x));
      if ([...ids].every((id) => current.has(id))) continue;
      await api('PUT', `/station/${sid}/file/${mediaId}`, { playlists: [...new Set([...current, ...ids])] });
    }

    // Disable AzuraCast's empty auto-created "default" playlist, if any, to keep things tidy.
    for (const pl of playlists) {
      if (pl.name === 'default' && pl.is_enabled && !def.playlists.some((p) => p.name === 'default')) {
        await api('PUT', `/station/${sid}/playlist/${pl.id}/toggle`);
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
