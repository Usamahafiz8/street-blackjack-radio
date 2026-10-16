import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const trimSlash = (s) => (s || '').replace(/\/+$/, '');
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

// Used when AZURACAST_PUBLIC_URL / PUBLIC_BASE_URL are "auto": URLs are built with this
// placeholder and replaced per request with the origin the client actually used
// (local development: localhost, LAN IP and a temporary HTTPS tunnel at the same time).
export const AUTO_ORIGIN = 'https://sbr-request-origin.invalid';

export function loadConfig(env = process.env) {
  const autoOr = (v) => (v === 'auto' ? AUTO_ORIGIN : trimSlash(v));
  const cfg = {
    port: num(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    // URL the registry uses to reach AzuraCast (inside the server, plain HTTP is fine).
    azuracastInternalUrl: trimSlash(env.AZURACAST_INTERNAL_URL || env.AZURACAST_PUBLIC_URL),
    // Public HTTPS origin of AzuraCast. Any stream/art URL is rewritten to this origin. "auto" = per request.
    azuracastPublicUrl: autoOr(env.AZURACAST_PUBLIC_URL),
    // Other host:port values AzuraCast may use in its URLs (e.g. its base_url), comma-separated.
    azuracastAliasHosts: (env.AZURACAST_ALIAS_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean),
    // Public origin of this API (used to build artwork URLs). "auto" = per request.
    publicBaseUrl: autoOr(env.PUBLIC_BASE_URL),
    // Trust X-Forwarded-Proto/Host from the reverse proxy in front (needed for "auto").
    trustProxyHeaders: env.TRUST_PROXY_HEADERS === 'true',
    pollIntervalMs: num(env.POLL_INTERVAL_MS, 10_000),
    externalCheckIntervalMs: num(env.EXTERNAL_CHECK_INTERVAL_MS, 60_000),
    requestTimeoutMs: num(env.REQUEST_TIMEOUT_MS, 8_000),
    corsOrigins: (env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Only for local development: allow external stations on plain http://.
    allowInsecureStreams: env.ALLOW_INSECURE_STREAMS === 'true',
    stationsConfigPath:
      env.STATIONS_CONFIG || fileURLToPath(new URL('../config/stations.config.json', import.meta.url)),
    artDir: env.ART_DIR || fileURLToPath(new URL('../art/', import.meta.url)),
    stateDir: env.STATE_DIR || '',
  };
  return cfg;
}

/**
 * Reads stations.config.json, re-reading it only when the file changes,
 * so stations can be added or disabled without restarting the service.
 */
export class StationsConfig {
  constructor(path) {
    this.path = path;
    this.mtimeMs = -1;
    this.data = { azuracast: { overrides: {}, hide_playlists_matching: [] }, external: [] };
  }

  get() {
    try {
      const { mtimeMs } = statSync(this.path);
      if (mtimeMs !== this.mtimeMs) {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
        this.data = {
          azuracast: {
            overrides: parsed.azuracast?.overrides || {},
            hide_playlists_matching: parsed.azuracast?.hide_playlists_matching || [],
          },
          external: Array.isArray(parsed.external) ? parsed.external : [],
        };
        this.mtimeMs = mtimeMs;
      }
    } catch (err) {
      // Keep the last good config if the file is missing or mid-edit.
      console.error(JSON.stringify({ level: 'error', msg: 'stations config unreadable', error: err.message }));
    }
    return this.data;
  }
}
