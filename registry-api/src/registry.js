import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { StationsConfig } from './config.js';
import { fetchNowPlaying, makePublicUrl, compileHidePatterns, normalizeAzuraStation } from './azuracast.js';
import { checkStream, fetchStats, normalizeExternalStation } from './external.js';

const log = (level, msg, extra = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));

export class Registry {
  constructor(cfg, { fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.cfg = cfg;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.stationsConfig = new StationsConfig(cfg.stationsConfigPath);
    this.publicUrl = makePublicUrl({
      internalUrl: cfg.azuracastInternalUrl,
      publicUrl: cfg.azuracastPublicUrl,
      aliasHosts: cfg.azuracastAliasHosts || [],
    });

    this.azuracast = { raw: [], lastSuccessAt: null, lastError: null, stale: true };
    this.externalStatus = new Map(); // id -> { check, stats, checkedAt }
    this.timers = [];
    this.lastStateWrite = 0;
    this.loadState();
  }

  // ---------- lifecycle ----------
  async start() {
    await Promise.allSettled([this.refreshAzuracast(), this.refreshExternals()]);
    this.timers.push(setInterval(() => this.refreshAzuracast(), this.cfg.pollIntervalMs));
    this.timers.push(setInterval(() => this.refreshExternals(), this.cfg.externalCheckIntervalMs));
    for (const t of this.timers) t.unref?.();
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ---------- polling ----------
  async refreshAzuracast() {
    if (!this.cfg.azuracastInternalUrl) return;
    try {
      const raw = await fetchNowPlaying({
        baseUrl: this.cfg.azuracastInternalUrl,
        timeoutMs: this.cfg.requestTimeoutMs,
        fetchImpl: this.fetchImpl,
      });
      await this.verifyOfflineStations(raw);
      this.azuracast = { raw, lastSuccessAt: this.now(), lastError: null, stale: false };
      this.saveState();
    } catch (err) {
      if (!this.azuracast.stale || this.azuracast.lastError !== err.message) {
        log('warn', 'azuracast poll failed', { error: err.message });
      }
      this.azuracast = { ...this.azuracast, lastError: err.message, stale: true };
    }
  }

  /**
   * AzuraCast's is_online flag lags behind for a while after a station restart, so a station
   * can be reported offline while it is already streaming. When AzuraCast says "offline",
   * open the station's stream internally; if audio flows, treat the station as online.
   */
  async verifyOfflineStations(raw) {
    const internal = new URL(this.cfg.azuracastInternalUrl);
    await Promise.allSettled(
      raw
        .filter((np) => np?.station && !np.is_online)
        .map(async (np) => {
          const mounts = np.station.mounts || [];
          const src = (mounts.find((m) => m.is_default) || mounts[0])?.url || np.station.listen_url;
          if (!src) return;
          const u = new URL(src, internal);
          u.protocol = internal.protocol;
          u.host = internal.host;
          const check = await checkStream(u.toString(), {
            timeoutMs: Math.min(this.cfg.requestTimeoutMs, 4000),
            allowInsecure: true, // internal address only, never returned to clients
            fetchImpl: this.fetchImpl,
          });
          if (check.online) np.is_online = true;
        }),
    );
  }

  async refreshExternals() {
    const defs = this.stationsConfig.get().external.filter((d) => d.enabled !== false && d.id && d.stream_url);
    await Promise.allSettled(
      defs.map(async (def) => {
        const opts = { timeoutMs: this.cfg.requestTimeoutMs, fetchImpl: this.fetchImpl };
        const [check, stats] = await Promise.all([
          checkStream(def.stream_url, { ...opts, allowInsecure: this.cfg.allowInsecureStreams }),
          fetchStats(def.stats, opts),
        ]);
        const prev = this.externalStatus.get(def.id);
        if (prev?.check?.online !== check.online) {
          log('info', 'external station status', { id: def.id, online: check.online, reason: check.reason });
        }
        this.externalStatus.set(def.id, { check, stats, checkedAt: this.now() });
      }),
    );
  }

  // ---------- persistence (so a registry restart during an AzuraCast outage still lists stations) ----------
  loadState() {
    if (!this.cfg.stateDir) return;
    try {
      const saved = JSON.parse(readFileSync(join(this.cfg.stateDir, 'azuracast-last.json'), 'utf8'));
      if (Array.isArray(saved.raw)) {
        this.azuracast = { raw: saved.raw, lastSuccessAt: saved.savedAt ?? null, lastError: 'not_polled_yet', stale: true };
      }
    } catch {
      /* first run */
    }
  }

  saveState() {
    if (!this.cfg.stateDir || this.now() - this.lastStateWrite < 60_000) return;
    try {
      mkdirSync(this.cfg.stateDir, { recursive: true });
      const file = join(this.cfg.stateDir, 'azuracast-last.json');
      writeFileSync(`${file}.tmp`, JSON.stringify({ savedAt: this.now(), raw: this.azuracast.raw }));
      renameSync(`${file}.tmp`, file);
      this.lastStateWrite = this.now();
    } catch (err) {
      log('warn', 'could not save state', { error: err.message });
    }
  }

  // ---------- output ----------
  buildStations() {
    const conf = this.stationsConfig.get();
    const artBaseUrl = this.cfg.publicBaseUrl;
    const hidePatterns = compileHidePatterns(conf.azuracast.hide_playlists_matching);

    const azura = this.azuracast.raw
      .filter((np) => np?.station && np.station.is_public !== false)
      .map((np) =>
        normalizeAzuraStation(np, { overrides: conf.azuracast.overrides, hidePatterns, publicUrl: this.publicUrl, artBaseUrl }),
      )
      .map((s) =>
        // AzuraCast unreachable: its streams are almost certainly down too.
        this.azuracast.stale
          ? { ...s, online: false, status: 'offline', status_reason: 'azuracast_unreachable', listeners: null }
          : s,
      );

    const external = conf.external
      .filter((d) => d.enabled !== false && d.id && d.stream_url)
      .map((d) => {
        const st = this.externalStatus.get(d.id);
        return normalizeExternalStation(d, st?.check, st?.stats, { artBaseUrl });
      });

    const seen = new Set();
    return [...azura, ...external]
      .filter((s) => !s.hidden)
      .filter((s) => (seen.has(s.id) ? false : seen.add(s.id)))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((s) => this.present(s));
  }

  /** Final public shape. Elapsed time is computed at request time. */
  present(s) {
    const { hidden, order, azuracast_shortcode, ...out } = s;
    if (out.now_playing) {
      const { started_at_ms, duration_s, ...np } = out.now_playing;
      const elapsed = started_at_ms ? Math.max(0, Math.round((this.now() - started_at_ms) / 1000)) : null;
      out.now_playing = {
        ...np,
        started_at: started_at_ms ? new Date(started_at_ms).toISOString() : null,
        duration_s,
        elapsed_s: elapsed != null && duration_s ? Math.min(elapsed, duration_s) : elapsed,
      };
    }
    return out;
  }

  list() {
    return { generated_at: new Date(this.now()).toISOString(), stations: this.buildStations() };
  }

  get(id) {
    return this.buildStations().find((s) => s.id === id) || null;
  }

  health() {
    return {
      ok: true,
      azuracast: {
        reachable: !this.azuracast.stale,
        last_success_at: this.azuracast.lastSuccessAt ? new Date(this.azuracast.lastSuccessAt).toISOString() : null,
        last_error: this.azuracast.lastError,
      },
      external: Object.fromEntries(
        [...this.externalStatus].map(([id, st]) => [id, { online: st.check.online, reason: st.check.reason, checked_at: new Date(st.checkedAt).toISOString() }]),
      ),
    };
  }
}
