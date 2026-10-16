// Reads AzuraCast's PUBLIC Now Playing API (no API key) and converts it
// into the registry's station format.

export async function fetchNowPlaying({ baseUrl, timeoutMs, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl}/api/nowplaying`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`AzuraCast /api/nowplaying returned HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error('AzuraCast /api/nowplaying did not return an array');
  return body;
}

/** Rewrites AzuraCast URLs to the public HTTPS origin. */
export function makePublicUrl({ internalUrl, publicUrl }) {
  const internal = internalUrl ? new URL(internalUrl) : null;
  const pub = publicUrl ? new URL(publicUrl) : null;
  return (raw) => {
    if (!raw) return null;
    let u;
    try {
      u = new URL(raw, publicUrl || undefined);
    } catch {
      return null;
    }
    if (pub) {
      const isInternal = internal && u.host === internal.host;
      const isPublicHost = u.hostname === pub.hostname;
      if (isInternal || isPublicHost) {
        u.protocol = pub.protocol;
        u.hostname = pub.hostname;
        u.port = pub.port; // '' clears an internal port such as :8080
      }
    }
    return u.toString();
  };
}

export function compileHidePatterns(patterns) {
  return (patterns || []).map((p) => new RegExp(p, 'i'));
}

/**
 * @param {object} np        one element of /api/nowplaying
 * @param {object} opts      { overrides, hidePatterns, publicUrl, artBaseUrl }
 */
export function normalizeAzuraStation(np, { overrides = {}, hidePatterns = [], publicUrl, artBaseUrl }) {
  const st = np.station || {};
  const ov = overrides[st.shortcode] || {};

  const mounts = (st.mounts || [])
    .map((m) => ({
      url: publicUrl(m.url),
      format: m.format || null,
      bitrate: m.bitrate || null,
      is_default: Boolean(m.is_default),
    }))
    .filter((m) => m.url);
  const def = mounts.find((m) => m.is_default) || mounts[0];
  const stream = def
    ? { url: def.url, format: def.format, bitrate: def.bitrate }
    : { url: publicUrl(st.listen_url), format: null, bitrate: null };

  const cur = np.now_playing;
  let nowPlaying = null;
  if (cur && cur.song) {
    const isAdBreak = Boolean(cur.playlist) && hidePatterns.some((re) => re.test(cur.playlist));
    nowPlaying = {
      title: isAdBreak ? null : cur.song.title || cur.song.text || null,
      artist: isAdBreak ? null : cur.song.artist || null,
      programme: isAdBreak ? null : cur.playlist || null,
      art_url: isAdBreak ? null : publicUrl(cur.song.art),
      is_ad_break: isAdBreak,
      started_at_ms: cur.played_at ? cur.played_at * 1000 : null,
      duration_s: cur.duration || null,
    };
  }

  return {
    id: ov.id || String(st.shortcode || st.id).replace(/_/g, '-'),
    type: 'azuracast',
    name: ov.name || st.name,
    genre: ov.genre || null,
    description: ov.description || st.description || null,
    order: ov.order ?? 100,
    hidden: Boolean(ov.hidden),
    online: Boolean(np.is_online),
    status: np.is_online ? 'online' : 'offline',
    status_reason: np.is_online ? null : 'azuracast_station_offline',
    stream,
    streams: mounts.map(({ is_default, ...m }) => m),
    hls_url: st.hls_enabled ? publicUrl(st.hls_url) : null,
    artwork_url: ov.artwork ? `${artBaseUrl}/art/${ov.artwork}` : null,
    listeners: np.listeners ? { current: np.listeners.current ?? null, unique: np.listeners.unique ?? null } : null,
    now_playing: nowPlaying,
    azuracast_shortcode: st.shortcode,
  };
}
