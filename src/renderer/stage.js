// Escenario: reproduce archivos locales y videos de YouTube. Se controla desde la ventana de control.
// Incluye fundido entre canciones (dos reproductores locales), letras tipo karaoke y visualizadores.
(() => {
  const body = document.body;
  const $ = (id) => document.getElementById(id);
  const players = [$('local-media'), $('local-media-b')];
  let media = players[0];     // reproductor local activo

  let current = null;         // item cargado
  let kind = null;            // 'local' | 'yt'
  let volume = 0.8;
  let muted = false;
  let ytPlayer = null;
  let ytReady = false;
  let ytQueued = null;        // carga pendiente mientras se inicializa la API
  let ytApiPromise = null;
  let toastTimer = null;
  let dual = false;
  let crossfadeSecs = 0;
  let nearSent = null;
  let fading = null;          // { from, to, start, dur }

  // ---------- Textos (idioma) ----------
  const TXT = {
    es: {
      hint: 'Elige una canción o un video para empezar', hintDual: ' · Doble clic: pantalla completa',
      noConn: 'Sin conexión con YouTube', badUrl: 'El enlace del video no es válido.', html5: 'Este video no se puede reproducir aquí.',
      notFound: 'El video no existe o es privado.', embed: 'El propietario no permite reproducir este video fuera de YouTube.',
      rejected: 'YouTube rechazó la reproducción incrustada.', ytErr: 'Error de YouTube ({code}).',
      format: 'Formato no compatible o archivo no disponible.', cantPlay: 'No se pudo reproducir: {msg}',
    },
    en: {
      hint: 'Pick a song or a video to start', hintDual: ' · Double-click: full screen',
      noConn: 'Can’t reach YouTube', badUrl: 'The video link is not valid.', html5: 'This video can’t be played here.',
      notFound: 'The video doesn’t exist or is private.', embed: 'The owner doesn’t allow this video to play outside YouTube.',
      rejected: 'YouTube rejected embedded playback.', ytErr: 'YouTube error ({code}).',
      format: 'Unsupported format or file not available.', cantPlay: 'Couldn’t play: {msg}',
    },
  };
  let lang = 'es';
  const tx = (k, v = {}) => (TXT[lang]?.[k] ?? TXT.es[k]).replace(/\{(\w+)\}/g, (_, n) => v[n] ?? '');
  function renderHint() { $('idle-hint').textContent = tx('hint') + (dual ? tx('hintDual') : ''); }
  renderHint();

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  function setMode(m) { body.dataset.mode = m; }

  // ---------- YouTube ----------
  function loadYTApi() {
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise((resolve, reject) => {
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { ytApiPromise = null; reject(new Error(tx('noConn'))); };
      document.head.appendChild(s);
    });
    return ytApiPromise;
  }

  const YT_ERRORS = { 2: 'badUrl', 5: 'html5', 100: 'notFound', 101: 'embed', 150: 'embed', 153: 'rejected' };

  async function playYouTube(item, autoplay, startAt) {
    setMode('yt');
    try {
      await loadYTApi();
    } catch (e) {
      window.stage.event({ type: 'error', id: item.id, message: e.message });
      return;
    }
    if (!ytPlayer) {
      ytQueued = { item, autoplay, startAt };
      ytPlayer = new YT.Player('yt-player', {
        host: 'https://www.youtube.com',
        videoId: item.videoId,
        playerVars: {
          autoplay: autoplay ? 1 : 0, controls: 0, rel: 0, iv_load_policy: 3, modestbranding: 1,
          playsinline: 1, disablekb: 1, fs: 0, cc_load_policy: 0, start: Math.floor(startAt || 0),
          origin: location.origin,
        },
        events: {
          onReady: () => {
            ytReady = true;
            applyVolume();
            const q = ytQueued;
            ytQueued = null;
            if (q && q.item.videoId !== item.videoId) loadIntoYT(q);
            else if (autoplay) ytPlayer.playVideo();
          },
          onStateChange: (e) => {
            if (!current || kind !== 'yt') return;
            if (e.data === YT.PlayerState.ENDED) window.stage.event({ type: 'ended', id: current.id });
            if (e.data === YT.PlayerState.PLAYING) window.stage.event({ type: 'playing', id: current.id });
          },
          onError: (e) => {
            const msg = tx(YT_ERRORS[e.data] || 'ytErr', { code: e.data });
            toast(msg);
            if (current) window.stage.event({ type: 'error', id: current.id, message: msg, code: e.data });
          },
        },
      });
      return;
    }
    if (!ytReady) { ytQueued = { item, autoplay, startAt }; return; }
    loadIntoYT({ item, autoplay, startAt });
  }

  function loadIntoYT({ item, autoplay, startAt }) {
    applyVolume();
    if (autoplay) ytPlayer.loadVideoById({ videoId: item.videoId, startSeconds: startAt || 0 });
    else ytPlayer.cueVideoById({ videoId: item.videoId, startSeconds: startAt || 0 });
  }

  function stopYT() {
    if (ytPlayer && ytReady) { try { ytPlayer.stopVideo(); } catch { /* ignorado */ } }
  }

  // ---------- Local ----------
  function clear(el) {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }
  function stopLocal() {
    fading = null;
    players.forEach(clear);
  }

  function showAudioInfo(item, cover) {
    $('a-title').textContent = item.title || '';
    $('a-artist').textContent = [item.artist, item.album].filter(Boolean).join(' — ');
    const c = $('cover');
    const bg = $('audio-bg');
    const set = (url) => {
      c.style.backgroundImage = url ? `url("${url}")` : ''; c.classList.toggle('empty', !url);
      bg.style.backgroundImage = url ? `url("${url}")` : ''; bg.classList.toggle('empty', !url);
    };
    set(cover);
    if (cover) {
      const probe = new Image(); // si la canción no tiene carátula el servidor responde 404
      probe.onerror = () => set(null);
      probe.src = cover;
    }
  }

  function playLocal(item, src, cover, autoplay, startAt, xfade) {
    const isVideo = item.media === 'video';
    if (!isVideo) showAudioInfo(item, cover);
    window.stage.attachLocal();
    const canFade = xfade > 0 && kind === 'local' && !media.paused && media.getAttribute('src');
    if (canFade) {
      // Fundido: el reproductor actual baja mientras el otro sube
      const from = media;
      const to = players[0] === media ? players[1] : players[0];
      clear(to);
      to.src = src;
      to.volume = 0;
      to.muted = muted;
      media = to;
      players.forEach((p) => p.classList.toggle('active', p === to));
      setMode(isVideo ? 'video' : 'audio');
      fading = { from, to, start: performance.now(), dur: xfade * 1000, fromVol: from.volume };
      to.play().catch((e) => window.stage.event({ type: 'error', id: item.id, message: tx('cantPlay', { msg: e.message }) }));
      return;
    }
    stopLocal();
    players.forEach((p) => p.classList.toggle('active', p === media));
    setMode(isVideo ? 'video' : 'audio');
    media.src = src;
    applyVolume();
    if (startAt) media.currentTime = startAt;
    if (autoplay) media.play().catch((e) => window.stage.event({ type: 'error', id: item.id, message: tx('cantPlay', { msg: e.message }) }));
  }

  // setInterval (no requestAnimationFrame): debe seguir aunque la ventana esté tapada o minimizada
  setInterval(() => {
    if (!fading) return;
    const k = Math.min(1, (performance.now() - fading.start) / fading.dur);
    const target = volume;
    fading.to.volume = target * k;
    fading.from.volume = fading.fromVol * (1 - k);
    if (k >= 1) { clear(fading.from); fading.from.volume = target; fading = null; }
  }, 40);

  players.forEach((el) => {
    el.addEventListener('ended', () => el === media && current && kind === 'local' && window.stage.event({ type: 'ended', id: current.id }));
    el.addEventListener('playing', () => el === media && current && window.stage.event({ type: 'playing', id: current.id }));
    el.addEventListener('error', () => {
      if (el !== media || !current || kind !== 'local' || !el.getAttribute('src')) return;
      const msg = tx('format');
      toast(msg);
      window.stage.event({ type: 'error', id: current.id, message: msg });
    });
  });

  // ---------- Volumen ----------
  function applyVolume() {
    players.forEach((p) => { p.muted = muted; });
    if (!fading) media.volume = volume;
    if (ytPlayer && ytReady) {
      ytPlayer.setVolume(Math.round(volume * 100));
      if (muted) ytPlayer.mute(); else ytPlayer.unMute();
    }
  }

  // ---------- Letras tipo karaoke ----------
  let lyrics = null;          // { id, lines:[{t,text}] } o { id, plain }
  let showLyrics = false;
  let lastLine = -2;
  function setLyrics(l) {
    lyrics = l;
    lastLine = -2;
    const box = $('lyrics');
    box.innerHTML = '';
    box.classList.toggle('has', !!(l && (l.lines?.length || l.plain)));
    $('audio-view').querySelector('.audio-inner').classList.toggle('lyr', showLyrics && box.classList.contains('has'));
  }
  (function lyricLoop() {
    requestAnimationFrame(lyricLoop);
    if (!showLyrics || !lyrics || !current || lyrics.id !== current.id || !lyrics.lines?.length) return;
    const t = getTime() + 0.25;
    const L = lyrics.lines;
    let i = -1;
    for (let k = 0; k < L.length; k++) { if (L[k].t <= t) i = k; else break; }
    const box = $('lyrics');
    if (i !== lastLine) {
      lastLine = i;
      const line = (k, cls) => (k >= 0 && k < L.length && L[k].text ? `<div class="l ${cls}">${esc(L[k].text)}${cls === 'cur' ? `<span class="fill">${esc(L[k].text)}</span>` : ''}</div>` : `<div class="l ${cls}">&nbsp;</div>`);
      box.innerHTML = line(i - 1, 'prev') + (i >= 0 ? line(i, 'cur') : `<div class="l cur">♪</div>`) + line(i + 1, 'next');
    }
    const cur = box.querySelector('.l.cur');
    if (cur && i >= 0) {
      const end = L[i + 1]?.t ?? (L[i].t + 4);
      const k = Math.max(0, Math.min(1, (t - L[i].t) / Math.max(0.5, end - L[i].t)));
      cur.style.setProperty('--k', (k * 104).toFixed(1) + '%');
    }
  })();
  function renderPlainLyrics() {
    if (!lyrics?.plain || lyrics.lines?.length) return;
    $('lyrics').innerHTML = `<div class="plain">${esc(lyrics.plain.split('\n').slice(0, 4).join(' · '))}</div>`;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Comandos ----------
  window.stage.onCommand((c) => {
    switch (c.type) {
      case 'load': {
        const prevKind = kind;
        current = c.item;
        nearSent = null;
        setLyrics(null);
        if (c.item.type === 'youtube') {
          if (prevKind === 'local') stopLocal();
          kind = 'yt';
          playYouTube(c.item, c.autoplay !== false, c.startAt);
        } else {
          if (prevKind === 'yt') stopYT();
          playLocal(c.item, c.src, c.cover, c.autoplay !== false, c.startAt, prevKind === 'local' ? c.crossfade : 0);
          kind = 'local';
        }
        break;
      }
      case 'play': commandPlay(); break;
      case 'pause': commandPause(); break;
      case 'toggle': if (isPaused()) commandPlay(); else commandPause(); break;
      case 'seek': seekTo(c.time); break;
      case 'seekRel': seekTo(getTime() + c.delta); break;
      case 'volume':
        volume = c.volume; muted = !!c.muted;
        applyVolume();
        break;
      case 'crossfade': crossfadeSecs = c.secs || 0; break;
      case 'lyrics':
        if (current && c.id === current.id) { setLyrics(c.data ? { id: c.id, lines: c.data.synced, plain: c.data.plain } : null); renderPlainLyrics(); }
        break;
      case 'showLyrics':
        showLyrics = !!c.on;
        body.classList.toggle('show-lyrics', showLyrics);
        $('audio-view').querySelector('.audio-inner').classList.toggle('lyr', showLyrics && $('lyrics').classList.contains('has'));
        lastLine = -2;
        renderPlainLyrics();
        break;
      case 'viz': body.dataset.viz = c.mode || 'bars'; break;
      case 'lang': lang = c.lang; renderHint(); break;
      case 'theme':
        document.documentElement.style.setProperty('--accent', c.accent);
        document.documentElement.style.setProperty('--accent2', c.accent2);
        document.documentElement.style.setProperty('--accent-2', c.accent2);
        break;
      case 'stop':
        stopLocal(); stopYT();
        current = null; kind = null;
        setLyrics(null);
        setMode('idle');
        break;
    }
  });

  function commandPlay() {
    if (kind === 'local') media.play().catch(() => {});
    else if (kind === 'yt' && ytReady) ytPlayer.playVideo();
  }
  function commandPause() {
    if (fading) { clear(fading.from); fading = null; media.volume = volume; }
    if (kind === 'local') media.pause();
    else if (kind === 'yt' && ytReady) ytPlayer.pauseVideo();
  }

  function isPaused() {
    if (kind === 'local') return media.paused;
    if (kind === 'yt' && ytReady) {
      const s = ytPlayer.getPlayerState();
      return s !== YT.PlayerState.PLAYING && s !== YT.PlayerState.BUFFERING;
    }
    return true;
  }
  function getTime() {
    if (kind === 'local') return media.currentTime || 0;
    if (kind === 'yt' && ytReady) return ytPlayer.getCurrentTime() || 0;
    return 0;
  }
  function getDuration() {
    if (kind === 'local') return isFinite(media.duration) ? media.duration : 0;
    if (kind === 'yt' && ytReady) return ytPlayer.getDuration() || 0;
    return 0;
  }
  function seekTo(t) {
    const d = getDuration();
    t = Math.max(0, d ? Math.min(t, d - 0.25) : t);
    if (kind === 'local') media.currentTime = t;
    else if (kind === 'yt' && ytReady) ytPlayer.seekTo(t, true);
  }

  // ---------- Estado periódico hacia el control ----------
  setInterval(() => {
    if (!current) return;
    let buffering = false;
    if (kind === 'yt' && ytReady) buffering = ytPlayer.getPlayerState() === YT.PlayerState.BUFFERING;
    else if (kind === 'local') buffering = media.readyState < 3 && !media.paused;
    const time = getTime();
    const duration = getDuration();
    window.stage.state({ id: current.id, time, duration, paused: isPaused(), buffering });
    // Aviso para empezar el fundido con la siguiente canción
    if (kind === 'local' && crossfadeSecs > 0 && duration > crossfadeSecs * 2 && !isPaused() && !fading
      && duration - time <= crossfadeSecs && nearSent !== current.id) {
      nearSent = current.id;
      window.stage.event({ type: 'nearEnd', id: current.id });
    }
  }, 250);

  // ---------- Pantalla completa / teclado ----------
  document.addEventListener('dblclick', () => window.stage.dblclick());
  document.addEventListener('keydown', (e) => {
    const k = e.code === 'Space' ? 'Space' : e.key;
    window.stage.key(k);
    e.preventDefault();
  });
  window.stage.onMode((m) => { dual = !!m.dual; body.classList.toggle('dual', dual); renderHint(); });
})();
