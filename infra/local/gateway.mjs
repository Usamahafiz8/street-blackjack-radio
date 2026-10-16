#!/usr/bin/env node
// LOCAL DEVELOPMENT ONLY - the single public entry point while testing on this PC.
// On the VPS, Caddy does this job (infra/Caddyfile).
//
// Listens on all network interfaces (so a phone on the same Wi-Fi can connect) and exposes
// ONLY what a listener needs:
//   /                       test player (static files from /player)
//   /config.js              player config (API = same origin)
//   /v1/*, /art/*, /health  Station Registry API      -> localhost:3000
//   /listen/*, /hls/*       AzuraCast audio streams   -> localhost:18080
//   /api/station/<s>/art/<id>  AzuraCast album art (images only) -> localhost:18080
// Everything else - the AzuraCast dashboard, login, admin API, setup - is NOT proxied (404).
// The AzuraCast admin stays on http://localhost:18080, reachable only from this PC.
//
//   node infra/local/gateway.mjs            (PORT=8088 by default)
// A Cloudflare quick tunnel can then point at http://localhost:8088 for temporary HTTPS.
import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8088);
const AZURACAST = { host: '127.0.0.1', port: Number(process.env.AZURACAST_PORT || 18080) };
const REGISTRY = { host: '127.0.0.1', port: Number(process.env.REGISTRY_PORT || 3000) };
const PLAYER_DIR = normalize(fileURLToPath(new URL('../../player/', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const AUDIO_PREFIXES = ['/listen/', '/hls/'];
// The only AzuraCast API path let through: public, read-only album art used in now-playing data.
const AZURACAST_ART = /^\/api\/station\/[a-z0-9_]+\/art\/[A-Za-z0-9_-]+(\.(jpg|png|webp))?$/;
// ...which may redirect to AzuraCast's generic cover image under /static (images only).
const AZURACAST_STATIC_IMAGE = /^\/static\/[A-Za-z0-9_./-]+\.(jpg|jpeg|png|webp|svg)$/;
const REGISTRY_PREFIXES = ['/v1/', '/art/'];

const log = (...a) => console.log(new Date().toISOString(), ...a);

// Temporary HTTPS tunnel services: visitors always arrive over HTTPS, even when the tunnel
// doesn't send X-Forwarded-Proto (localhost.run doesn't). Otherwise stream links would be
// http:// and Safari would block them as mixed content.
const HTTPS_TUNNEL_SUFFIXES = (process.env.HTTPS_TUNNEL_SUFFIXES || '.trycloudflare.com,.lhr.life,.localhost.run')
  .split(',').map((s) => s.trim()).filter(Boolean);

function clientOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  const viaTunnel = HTTPS_TUNNEL_SUFFIXES.some((s) => host.split(':')[0].endsWith(s));
  // cloudflared adds X-Forwarded-Proto: https; plain LAN/localhost requests are http.
  const fwd = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return { proto: viaTunnel || fwd === 'https' ? 'https' : 'http', host };
}

function proxy(req, res, target, { stream = false } = {}) {
  const { proto, host } = clientOrigin(req);
  const headers = {
    // Pass through only what the upstream needs; never cookies or auth (nothing admin-related goes through).
    accept: req.headers.accept || '*/*',
    'user-agent': req.headers['user-agent'] || '',
    range: req.headers.range,
    'if-none-match': req.headers['if-none-match'],
    origin: req.headers.origin,
    host: `${target.host}:${target.port}`,
    'x-forwarded-for': req.socket.remoteAddress,
  };
  // The registry builds stream URLs from the client's address. AzuraCast must NOT get these:
  // it rejects a forwarded host that includes a port ("localhost:8088") with HTTP 500.
  if (target === REGISTRY) {
    headers['x-forwarded-proto'] = proto;
    headers['x-forwarded-host'] = host;
  }
  for (const k of Object.keys(headers)) if (headers[k] === undefined) delete headers[k];

  const up = request({ ...target, method: req.method, path: req.url, headers }, (ur) => {
    const out = { ...ur.headers };
    delete out['set-cookie'];
    // Redirects from AzuraCast point at its own (local-only) address; send the client to the gateway instead.
    if (out.location) out.location = out.location.replace(/^https?:\/\/(localhost|127\.0\.0\.1):\d+/, `${proto}://${host}`);
    if (stream) out['cache-control'] = 'no-store';
    res.writeHead(ur.statusCode || 502, out);
    ur.pipe(res);
  });
  up.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`upstream unavailable: ${err.code || err.message}\n`);
    } else res.destroy();
  });
  // Listener left: close the upstream stream too, so AzuraCast's listener count drops.
  res.on('close', () => up.destroy());
  req.pipe(up);
}

async function serveStatic(req, res, pathname) {
  if (pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
    return res.end("window.SBR_CONFIG = { apiBase: '', preferHls: false, refreshMs: 15000 };\n");
  }
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = normalize(join(PLAYER_DIR, rel));
  if (!file.startsWith(PLAYER_DIR) || file.includes(`${sep}tools${sep}`)) {
    res.writeHead(404);
    return res.end();
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found\n');
  }
}

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' });
    return res.end();
  }
  if (AUDIO_PREFIXES.some((p) => pathname.startsWith(p))) {
    log('audio', req.socket.remoteAddress, pathname);
    return proxy(req, res, AZURACAST, { stream: true });
  }
  if ((AZURACAST_ART.test(pathname) || AZURACAST_STATIC_IMAGE.test(pathname)) && !pathname.includes('..') && req.method !== 'OPTIONS') {
    return proxy(req, res, AZURACAST);
  }
  if (REGISTRY_PREFIXES.some((p) => pathname.startsWith(p)) || pathname === '/health') {
    return proxy(req, res, REGISTRY);
  }
  return serveStatic(req, res, pathname);
}).listen(PORT, '0.0.0.0', () => {
  log(`gateway on http://0.0.0.0:${PORT}  (player, registry API and audio only; AzuraCast admin is NOT exposed)`);
});
