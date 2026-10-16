/* Street Blackjack Radio - standalone test player.
 * Plain JS, no build step. One <audio> element for the whole session (required for iOS).
 * "Pause" on a live stream = disconnect; "Play" = rejoin the live broadcast.
 */
(() => {
  'use strict';

  const CFG = window.SBR_CONFIG || {};
  const qs = new URLSearchParams(location.search);
  const API_BASE = (qs.get('api') || CFG.apiBase || deriveApiBase()).replace(/\/+$/, '');
  const REFRESH_MS = CFG.refreshMs || 15000;
  // Capped at 10 s: the registry refreshes AzuraCast status every ~10 s, so a restarted
  // station is picked up quickly without hammering the server.
  const RETRY_DELAYS = [1000, 2000, 4000, 7000, 10000];
  const STALL_MS = 12000;
  const LS = { station: 'sbr.station', volume: 'sbr.volume', muted: 'sbr.muted', cache: 'sbr.stations' };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    power: $('power'), powerLabel: $('power-label'), banner: $('banner'),
    art: $('art'), live: $('live-badge'), nowStation: $('now-station'), nowTitle: $('now-title'),
    nowMeta: $('now-meta'), status: $('status'), playpause: $('playpause'), mute: $('mute'),
    volume: $('volume'), volumeWrap: $('volume-wrap'), volumeNote: $('volume-note'),
    list: $('stations'), apiBase: $('api-base'), log: $('log'),
  };

  const audio = new Audio();
  audio.preload = 'none';

  const state = {
    stations: [],
    selectedId: store.get(LS.station),
    radioOn: false,      // master switch
    wantPlaying: false,  // user wants audio right now (radio on and not paused)
    needsTap: false,     // the browser blocked play(), so a tap is needed
    retry: 0,
    retryTimer: null,
    lastTime: 0,
    lastProgressAt: 0,
    stationsFromCache: false,
  };

  // ---------------------------------------------------------------- helpers
  function deriveApiBase() {
    if (location.hostname.startsWith('player.')) {
      return `${location.protocol}//api.${location.hostname.slice('player.'.length)}`;
    }
    return location.origin;
  }

  function log(msg) {
    const li = document.createElement('li');
    li.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
    el.log.prepend(li);
    while (el.log.children.length > 60) el.log.lastChild.remove();
  }

  const selected = () => state.stations.find((s) => s.id === state.selectedId) || null;
  const fmt = (s) => {
    if (s == null) return '';
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  };

  // iOS ignores audio.volume (always 1). Detect it rather than sniffing user agents.
  const volumeSupported = (() => {
    const a = document.createElement('audio');
    a.volume = 0.5;
    return a.volume === 0.5 && !/iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  })();

  // ---------------------------------------------------------------- station list
  async function loadStations() {
    try {
      const res = await fetch(`${API_BASE}/v1/stations`, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      state.stations = body.stations || [];
      state.stationsFromCache = false;
      store.set(LS.cache, JSON.stringify(state.stations));
      hideBanner();
    } catch (err) {
      log(`station list failed: ${err.message}`);
      if (!state.stations.length) {
        try { state.stations = JSON.parse(store.get(LS.cache) || '[]'); } catch { state.stations = []; }
        state.stationsFromCache = true;
      }
      showBanner(state.stations.length
        ? 'Can’t reach the station list right now - showing the last known stations.'
        : 'Can’t reach the radio service right now. Retrying…');
    }
    if (!selected() && state.stations.length) {
      state.selectedId = (state.stations.find((s) => s.online) || state.stations[0]).id;
    }
    render();
  }

  // ---------------------------------------------------------------- playback
  function streamUrlFor(st) {
    let url = st.stream && st.stream.url;
    if (CFG.preferHls && st.hls_url && audio.canPlayType('application/vnd.apple.mpegurl')) url = st.hls_url;
    if (!url) return null;
    // Cache-buster: always open a fresh connection to the LIVE point, never a stale buffer.
    return url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
  }

  function startStream(reason) {
    clearTimeout(state.retryTimer);
    const st = selected();
    if (!st) return setStatus('Choose a station');
    if (!st.online) {
      stopAudio();
      setStatus(`${st.name} is offline right now`);
      scheduleRetry('station offline');
      return;
    }
    const url = streamUrlFor(st);
    log(`connect (${reason}) → ${st.id}`);
    setStatus('Connecting…');
    audio.src = url;
    state.lastTime = 0;
    state.lastProgressAt = Date.now();
    const p = audio.play();
    if (p && p.catch) {
      p.then(() => { state.needsTap = false; render(); }).catch((err) => {
        if (err.name === 'NotAllowedError') {
          // iOS/Android blocked autoplay (e.g. after a phone call). Ask for a tap.
          state.needsTap = true;
          setStatus('Tap ▶ Play to resume');
          log('play() blocked - waiting for a tap');
          render();
        } else if (err.name !== 'AbortError') {
          // Media errors also fire the 'error' event, which schedules the retry.
          log(`play() failed: ${err.name}`);
        }
      });
    }
  }

  function stopAudio() {
    clearTimeout(state.retryTimer);
    audio.pause();
    audio.removeAttribute('src');
    audio.load(); // closes the connection, so a paused listener uses no bandwidth
  }

  function scheduleRetry(why) {
    if (!state.wantPlaying) return;
    clearTimeout(state.retryTimer);
    const delay = RETRY_DELAYS[Math.min(state.retry, RETRY_DELAYS.length - 1)];
    state.retry++;
    log(`retry in ${delay / 1000}s (${why})`);
    setStatus(`Reconnecting in ${Math.round(delay / 1000)}s…`);
    state.retryTimer = setTimeout(async () => {
      await loadStations(); // picks up online/offline changes
      if (state.wantPlaying) startStream('retry');
    }, delay);
  }

  function play(reason) {
    state.radioOn = true;
    state.wantPlaying = true;
    state.retry = 0;
    startStream(reason);
    render();
  }

  function pause() {
    state.wantPlaying = false;
    stopAudio();
    setStatus('Paused - press Play to rejoin live');
    render();
  }

  function powerOff() {
    state.radioOn = false;
    state.wantPlaying = false;
    state.needsTap = false;
    stopAudio();
    setStatus('Radio is off');
    render();
  }

  function selectStation(id) {
    state.selectedId = id;
    store.set(LS.station, id);
    if (state.radioOn) play('switch station');
    else render();
  }

  // Audio element events → reconnect logic
  audio.addEventListener('playing', () => {
    state.retry = 0;
    state.lastProgressAt = Date.now();
    setStatus('Playing live');
    log('playing');
    render();
  });
  audio.addEventListener('waiting', () => { setStatus('Buffering…'); log('waiting'); });
  audio.addEventListener('timeupdate', () => {
    if (audio.currentTime !== state.lastTime) {
      state.lastTime = audio.currentTime;
      state.lastProgressAt = Date.now();
    }
  });
  for (const ev of ['error', 'ended', 'stalled']) {
    audio.addEventListener(ev, () => {
      if (!state.wantPlaying || !audio.getAttribute('src')) return;
      log(`audio ${ev}${audio.error ? ' code ' + audio.error.code : ''}`);
      if (ev !== 'stalled') scheduleRetry(ev);
    });
  }
  audio.addEventListener('pause', () => {
    // Paused by the OS (call, Siri, other app) rather than by us.
    if (state.wantPlaying && audio.getAttribute('src')) {
      log('paused by system');
      setStatus('Interrupted - press Play to rejoin live');
    }
  });

  // Watchdog: if "playing" but no progress for STALL_MS, reconnect.
  setInterval(() => {
    if (!state.wantPlaying || state.needsTap || !audio.getAttribute('src') || audio.paused) return;
    if (Date.now() - state.lastProgressAt > STALL_MS) {
      log('watchdog: stream stalled');
      state.lastProgressAt = Date.now();
      scheduleRetry('stalled');
    }
  }, 4000);

  // Coming back to the app or tab: rejoin live if audio died while hidden.
  function onReturn(source) {
    if (document.visibilityState !== 'visible') return;
    loadStations();
    if (state.wantPlaying && (audio.paused || Date.now() - state.lastProgressAt > STALL_MS)) {
      log(`returned (${source}) - rejoining live`);
      startStream('return to app');
    }
  }
  document.addEventListener('visibilitychange', () => onReturn('visibility'));
  window.addEventListener('pageshow', (e) => e.persisted && onReturn('pageshow'));
  window.addEventListener('online', () => { log('network online'); if (state.wantPlaying) startStream('network back'); });
  window.addEventListener('offline', () => { log('network offline'); setStatus('No internet connection'); });

  // ---------------------------------------------------------------- Media Session (lock screen)
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const st = selected();
    const np = st && st.now_playing;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: np && np.is_ad_break ? 'Ad break' : (np && np.title) || (st ? st.name : 'Street Blackjack Radio'),
        artist: np && np.artist ? `${np.artist} · ${st.name}` : st ? st.name : '',
        album: 'Street Blackjack Radio',
        artwork: [{ src: (np && np.art_url) || (st && st.artwork_url) || new URL('icons/icon-512.png', location.href).href, sizes: '512x512' }],
      });
      navigator.mediaSession.playbackState = state.wantPlaying ? 'playing' : 'paused';
    } catch { /* older browsers */ }
  }
  if ('mediaSession' in navigator) {
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* unsupported */ } };
    set('play', () => play('lock screen'));
    set('pause', () => pause());
    set('stop', () => pause());
    set('nexttrack', () => stepStation(1));
    set('previoustrack', () => stepStation(-1));
    set('seekbackward', null);
    set('seekforward', null);
    set('seekto', null);
  }
  function stepStation(dir) {
    const live = state.stations.filter((s) => s.online);
    if (!live.length) return;
    const i = live.findIndex((s) => s.id === state.selectedId);
    selectStation(live[(i + dir + live.length) % live.length].id);
  }

  // ---------------------------------------------------------------- UI
  function setStatus(text) { el.status.textContent = text; }
  function showBanner(text) { el.banner.textContent = text; el.banner.hidden = false; }
  function hideBanner() { el.banner.hidden = true; }

  function render() {
    const st = selected();
    el.power.setAttribute('aria-pressed', String(state.radioOn));
    el.power.classList.toggle('on', state.radioOn);
    el.powerLabel.textContent = state.radioOn ? 'Radio ON' : 'Radio OFF';

    const playingNow = state.wantPlaying && !state.needsTap;
    el.playpause.textContent = playingNow ? '❚❚ Pause' : '▶ Play';
    el.playpause.setAttribute('aria-label', playingNow ? 'Pause' : 'Play');
    el.mute.textContent = audio.muted ? '🔇 Unmute' : '🔊 Mute';
    el.mute.setAttribute('aria-pressed', String(audio.muted));

    if (st) {
      el.nowStation.textContent = st.name;
      el.live.hidden = !(state.wantPlaying && st.online);
      // Station logo first (always ours, always loads); album art only when there's no logo.
      const art = st.artwork_url || (st.now_playing && st.now_playing.art_url) || 'icons/icon.svg';
      if (el.art.getAttribute('src') !== art) el.art.src = art;
      renderNowPlaying(st);
    }

    el.list.replaceChildren(...state.stations.map((s) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'station' + (s.id === state.selectedId ? ' selected' : '') + (s.online ? '' : ' offline');
      b.disabled = !s.online && s.id !== state.selectedId;
      if (s.id === state.selectedId) b.setAttribute('aria-current', 'true');
      const img = document.createElement('img');
      img.src = s.artwork_url || 'icons/icon.svg';
      img.alt = '';
      const text = document.createElement('span');
      text.className = 'st-text';
      const name = document.createElement('strong');
      name.textContent = s.name;
      const sub = document.createElement('small');
      const bits = [s.genre, s.online ? 'Live' : 'Offline'];
      if (s.listeners && s.listeners.current != null) bits.push(`${s.listeners.current} listening`);
      sub.textContent = bits.filter(Boolean).join(' · ');
      text.append(name, sub);
      b.append(img, text);
      b.addEventListener('click', () => selectStation(s.id));
      li.append(b);
      return li;
    }));
    updateMediaSession();
  }

  function renderNowPlaying(st) {
    const np = st.now_playing;
    if (!st.online) {
      el.nowTitle.textContent = 'Station offline';
      el.nowMeta.textContent = '';
      return;
    }
    if (!np) {
      el.nowTitle.textContent = st.description || st.genre || '';
      el.nowMeta.textContent = '';
      return;
    }
    if (np.is_ad_break) {
      el.nowTitle.textContent = 'Ad break';
      el.nowMeta.textContent = '';
      return;
    }
    el.nowTitle.textContent = [np.artist, np.title].filter(Boolean).join(' - ');
    let pos = '';
    if (np.started_at) {
      const elapsed = (Date.now() - Date.parse(np.started_at)) / 1000;
      pos = np.duration_s ? `${fmt(Math.min(elapsed, np.duration_s))} / ${fmt(np.duration_s)} into this mix` : `${fmt(elapsed)} in`;
    }
    el.nowMeta.textContent = [np.programme, pos].filter(Boolean).join(' · ');
  }
  setInterval(() => { const st = selected(); if (st) renderNowPlaying(st); }, 1000);

  // Never show a broken image: fall back to the app icon.
  el.art.addEventListener('error', () => { if (!el.art.src.endsWith('icons/icon.svg')) el.art.src = 'icons/icon.svg'; });

  // Controls
  el.power.addEventListener('click', () => (state.radioOn ? powerOff() : play('radio on')));
  el.playpause.addEventListener('click', () => (state.wantPlaying && !state.needsTap ? pause() : play('play button')));
  el.mute.addEventListener('click', () => {
    audio.muted = !audio.muted;
    store.set(LS.muted, audio.muted ? '1' : '0');
    render();
  });
  if (volumeSupported) {
    const v = parseFloat(store.get(LS.volume));
    audio.volume = Number.isFinite(v) ? v : 0.8;
    el.volume.value = audio.volume;
    el.volume.addEventListener('input', () => {
      audio.volume = parseFloat(el.volume.value);
      store.set(LS.volume, String(audio.volume));
    });
  } else {
    el.volumeWrap.hidden = true;
    el.volumeNote.hidden = false;
  }
  audio.muted = store.get(LS.muted) === '1';

  // Refresh station info while visible
  setInterval(() => { if (document.visibilityState === 'visible') loadStations(); }, REFRESH_MS);

  // PWA: cache the app shell only (never audio or API responses)
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch((e) => log(`service worker: ${e.message}`));
  }

  el.apiBase.textContent = API_BASE;
  log(`player started; API ${API_BASE}; software volume ${volumeSupported ? 'supported' : 'not supported (iOS)'}`);
  loadStations();
})();
