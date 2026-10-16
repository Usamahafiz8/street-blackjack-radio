// Health checks and optional stats for external stations (e.g. OnTop FM).
// Everything here runs server-side, so the external server does not need CORS.

const UA = 'StreetBlackjackRadio-Registry/1.0 (+health check)';
const AUDIO_TYPES = /audio\/|application\/ogg|mpegurl|application\/octet-stream|video\/mp2t/i;

/**
 * Opens the stream, reads the first chunk, then disconnects.
 * Returns { online, reason, content_type }.
 */
export async function checkStream(url, { timeoutMs, allowInsecure = false, fetchImpl = fetch }) {
  if (!url) return { online: false, reason: 'no_stream_url' };
  if (!url.startsWith('https://') && !allowInsecure) {
    return { online: false, reason: 'insecure_http_stream' };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Icy-MetaData': '0' },
    });
    if (!res.ok) return { online: false, reason: `http_${res.status}` };
    const contentType = res.headers.get('content-type') || '';
    if (!AUDIO_TYPES.test(contentType)) return { online: false, reason: 'not_audio', content_type: contentType };
    if (!res.body) return { online: false, reason: 'no_data' };
    const reader = res.body.getReader();
    const { value, done } = await reader.read();
    reader.cancel().catch(() => {});
    if (done || !value || value.length === 0) return { online: false, reason: 'no_data' };
    return { online: true, reason: null, content_type: contentType };
  } catch (err) {
    return { online: false, reason: ac.signal.aborted ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

function splitTitle(text) {
  if (!text) return { title: null, artist: null };
  const i = text.indexOf(' - ');
  return i > 0 ? { artist: text.slice(0, i).trim(), title: text.slice(i + 3).trim() } : { title: text.trim(), artist: null };
}

/**
 * Optional now-playing / listener stats.
 * stats = { type: 'icecast', url: '.../status-json.xsl', mount: '/live' }
 *       | { type: 'shoutcast', url: '.../stats?sid=1&json=1' }
 */
export async function fetchStats(stats, { timeoutMs, fetchImpl = fetch }) {
  if (!stats?.url) return null;
  try {
    const res = await fetchImpl(stats.url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (stats.type === 'icecast') {
      let sources = body?.icestats?.source;
      if (!sources) return null;
      if (!Array.isArray(sources)) sources = [sources];
      const src = (stats.mount && sources.find((s) => (s.listenurl || '').endsWith(stats.mount))) || sources[0];
      return { listeners: src.listeners ?? null, ...splitTitle(src.title || src.yp_currently_playing) };
    }
    if (stats.type === 'shoutcast') {
      return { listeners: body.currentlisteners ?? null, ...splitTitle(body.songtitle) };
    }
  } catch {
    // Stats are best-effort; never fail the station because of them.
  }
  return null;
}

export function normalizeExternalStation(def, check, stats, { artBaseUrl }) {
  const status = check ? (check.online ? 'online' : 'offline') : 'unknown';
  return {
    id: def.id,
    type: 'external',
    name: def.name,
    genre: def.genre || null,
    description: def.description || null,
    order: def.order ?? 100,
    hidden: Boolean(def.hidden),
    online: Boolean(check?.online),
    status,
    status_reason: check ? check.reason : 'not_checked_yet',
    stream: { url: def.stream_url, format: def.format || null, bitrate: def.bitrate || null },
    streams: [{ url: def.stream_url, format: def.format || null, bitrate: def.bitrate || null }],
    hls_url: def.hls_url || null,
    artwork_url: def.artwork
      ? /^https:\/\//.test(def.artwork)
        ? def.artwork
        : `${artBaseUrl}/art/${def.artwork}`
      : null,
    listeners: stats && stats.listeners != null ? { current: stats.listeners, unique: null } : null,
    now_playing:
      stats && (stats.title || stats.artist)
        ? { title: stats.title, artist: stats.artist, programme: null, art_url: null, is_ad_break: false, started_at_ms: null, duration_s: null }
        : null,
  };
}
