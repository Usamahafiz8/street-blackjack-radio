import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const trimSlash = (s) => (s || '').replace(/\/+$/, '');
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export function loadConfig(env = process.env) {
  const cfg = {
    port: num(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    // URL the registry uses to reach AzuraCast (inside the server, plain HTTP is fine).
    azuracastInternalUrl: trimSlash(env.AZURACAST_INTERNAL_URL || env.AZURACAST_PUBLIC_URL),
    // Public HTTPS origin of AzuraCast. Any stream/art URL is rewritten to this origin.
    azuracastPublicUrl: trimSlash(env.AZURACAST_PUBLIC_URL),
    // Public HTTPS origin of this API (used to build artwork URLs).
    publicBaseUrl: trimSlash(env.PUBLIC_BASE_URL),
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
