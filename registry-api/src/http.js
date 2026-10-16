import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ART_TYPES = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Exact origins, "*", or wildcard subdomains like "https://*.example.com". */
export function originAllowed(origin, allowList) {
  if (!origin) return false;
  for (const entry of allowList) {
    if (entry === '*' || entry === origin) return true;
    if (entry.includes('*.')) {
      const [scheme, host] = entry.split('://');
      const suffix = host.slice(1); // ".example.com"
      try {
        const o = new URL(origin);
        if (`${o.protocol}` === `${scheme}:` && o.host.endsWith(suffix)) return true;
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

export function createApp(registry, cfg) {
  const corsHeaders = (origin) => {
    const h = { Vary: 'Origin' };
    if (cfg.corsOrigins.includes('*')) h['Access-Control-Allow-Origin'] = '*';
    else if (originAllowed(origin, cfg.corsOrigins)) h['Access-Control-Allow-Origin'] = origin;
    return h;
  };

  const send = (req, res, status, body, extra = {}) => {
    const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(req.headers.origin),
      ...extra,
    });
    res.end(req.method === 'HEAD' ? undefined : payload);
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(req.headers.origin),
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(req, res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD, OPTIONS' });
    }

    try {
      if (path === '/v1/stations') {
        return send(req, res, 200, registry.list(), { 'Cache-Control': 'public, max-age=5' });
      }
      const m = path.match(/^\/v1\/stations\/([a-z0-9-]+)$/);
      if (m) {
        const station = registry.get(m[1]);
        return station
          ? send(req, res, 200, station, { 'Cache-Control': 'public, max-age=5' })
          : send(req, res, 404, { error: 'station_not_found' });
      }
      if (path === '/health') {
        return send(req, res, 200, registry.health(), { 'Cache-Control': 'no-store' });
      }
      const art = path.match(/^\/art\/([a-z0-9._-]+\.(svg|png|jpe?g|webp))$/i);
      if (art) {
        try {
          const file = await readFile(join(cfg.artDir, art[1]));
          return send(req, res, 200, file, {
            'Content-Type': ART_TYPES[art[2].toLowerCase()],
            'Cache-Control': 'public, max-age=86400',
          });
        } catch {
          return send(req, res, 404, { error: 'not_found' });
        }
      }
      if (path === '/') {
        return send(req, res, 200, { service: 'street-blackjack-radio-registry', endpoints: ['/v1/stations', '/v1/stations/{id}', '/health'] });
      }
      return send(req, res, 404, { error: 'not_found' });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'request failed', path, error: err.message }));
      return send(req, res, 500, { error: 'internal_error' });
    }
  });
}
