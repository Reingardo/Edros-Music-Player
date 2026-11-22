// Preload del escenario (pantalla de video).
// Se ejecuta en la página del escenario y TAMBIÉN dentro del reproductor de YouTube incrustado,
// para aplicar el preamplificador/ecualizador al sonido y quitar los anuncios.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const isTop = window === window.top;
const host = location.hostname;
const isYouTube = /(^|\.)youtube(-nocookie)?\.com$/.test(host);
const isStage = isTop && (host === '127.0.0.1' || host === 'localhost');

(function main() {
if (!isTop && !isYouTube) return; // iframes de terceros: no hacemos nada

// ---------------------------------------------------------------------------
// Motor de audio: preamplificador → ecualizador de 10 bandas → [igualador de volumen] → [limitador]
// ---------------------------------------------------------------------------
const FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
let settings = null;
let ctx = null;
let nodes = null;
const attached = new WeakSet();
const attachedList = [];

function dbToGain(db) { return Math.pow(10, db / 20); }

function ensureGraph() {
  if (ctx) return;
  ctx = new AudioContext({ latencyHint: 'playback' });
  const input = ctx.createGain();
  const pre = ctx.createGain();
  const filters = FREQS.map((f, i) => {
    const b = ctx.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === FREQS.length - 1 ? 'highshelf' : 'peaking';
    b.frequency.value = f;
    b.Q.value = 1.1;
    return b;
  });
  // Igualador de volumen: compresión suave + ganancia de compensación
  const norm = ctx.createDynamicsCompressor();
  norm.threshold.value = -30;
  norm.knee.value = 18;
  norm.ratio.value = 3.5;
  norm.attack.value = 0.01;
  norm.release.value = 0.35;
  const makeup = ctx.createGain();
  makeup.gain.value = dbToGain(7);
  norm.connect(makeup);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  input.connect(pre);
  let prev = pre;
  for (const f of filters) { prev.connect(f); prev = f; }
  analyser.connect(ctx.destination);
  nodes = { input, pre, filters, norm, makeup, limiter, analyser, last: prev, route: null };
  applySettings();
}

function applySettings() {
  if (!nodes || !settings) return;
  const on = settings.enabled !== false;
  const t = ctx.currentTime;
  nodes.pre.gain.setTargetAtTime(dbToGain(on ? settings.gain || 0 : 0), t, 0.02);
  nodes.filters.forEach((f, i) => f.gain.setTargetAtTime(on ? settings.bands?.[i] || 0 : 0, t, 0.02));
  const wantNorm = !!settings.normalize;
  const wantLimiter = (on && settings.limiter !== false) || wantNorm;
  const route = `${wantNorm}|${wantLimiter}`;
  if (nodes.route !== route) {
    for (const n of [nodes.last, nodes.makeup, nodes.limiter]) { try { n.disconnect(); } catch { /* sin conexión */ } }
    let tail = nodes.last;
    if (wantNorm) { tail.connect(nodes.norm); tail = nodes.makeup; }
    if (wantLimiter) { tail.connect(nodes.limiter); tail = nodes.limiter; }
    tail.connect(nodes.analyser);
    nodes.route = route;
  }
}

function attach(el) {
  if (!el || attached.has(el)) return;
  ensureGraph();
  try {
    const src = ctx.createMediaElementSource(el);
    src.connect(nodes.input);
    attached.add(el);
    attachedList.push(el);
    el.addEventListener('play', () => ctx.resume());
    if (!el.paused) ctx.resume();
  } catch (err) {
    console.warn('[preamp] no se pudo conectar el audio', err);
  }
}

ipcRenderer.invoke('preamp:get').then((s) => { settings = s; applySettings(); });
ipcRenderer.on('preamp:update', (_e, s) => { settings = s; applySettings(); });

// Nivel de graves para que la mascota baile al ritmo (≈15 veces por segundo, solo mientras suena)
let levelBuf = null;
let levelPeak = 0.05;
let bassNow = 0;            // también lo usan los visualizadores
function bass() {
  if (!nodes) return 0;
  if (!levelBuf) levelBuf = new Uint8Array(nodes.analyser.frequencyBinCount);
  nodes.analyser.getByteFrequencyData(levelBuf);
  let sum = 0;
  for (let i = 1; i < 14; i++) sum += levelBuf[i];
  return sum / 13 / 255;
}
setInterval(() => {
  const el = attachedList.find((m) => !m.paused && !m.muted);
  if (!nodes || !el) return;
  const b = bass();
  levelPeak = Math.max(levelPeak * 0.996, b, 0.05); // ganancia automática: funciona a cualquier volumen
  bassNow = Math.max(0, Math.min(1, (b / levelPeak - 0.55) * 2.2));
  ipcRenderer.send('player:level', bassNow);
}, 66);

// ---------------------------------------------------------------------------
// Reproductor de YouTube incrustado: sin anuncios + preamplificador
// ---------------------------------------------------------------------------
if (isYouTube) {
  // 1) En el contexto de la página: quitamos los anuncios de la respuesta del reproductor
  const pruneAds = () => {
    const KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
    const prune = (o) => {
      if (o && typeof o === 'object') {
        for (const k of KEYS) if (k in o) { try { delete o[k]; } catch { o[k] = undefined; } }
        if (o.playerResponse) prune(o.playerResponse);
        if (o.embedded_player_response && typeof o.embedded_player_response === 'object') prune(o.embedded_player_response);
      }
      return o;
    };
    const jp = JSON.parse;
    JSON.parse = function parse(...args) { return prune(jp.apply(this, args)); };
    const rj = Response.prototype.json;
    Response.prototype.json = function json() { return rj.call(this).then(prune); };
  };
  try {
    if (contextBridge.executeInMainWorld) contextBridge.executeInMainWorld({ func: pruneAds });
    else webFrame.executeJavaScript(`(${pruneAds.toString()})()`);
  } catch (e) {
    console.warn('[adblock] no se pudo instalar el filtro', e);
  }

  // 2) Ocultar restos visuales de anuncios
  const css = `.video-ads, .ytp-ad-module, .ytp-ad-overlay-container, .ytp-ad-image-overlay,
    .ytp-ad-text-overlay, .ytp-ad-player-overlay, .ytp-ad-preview-container, .ytp-paid-content-overlay,
    .ytp-pause-overlay, .ytp-show-cards-title, .ytp-ce-element, .ytp-chrome-top, .ytp-watermark,
    .ytp-youtube-button, .ytp-impression-link, .ytp-gradient-top,
    .ytp-caption-window-container { display: none !important; }`; /* subtítulos: usamos nuestras letras */
  const injectCss = () => {
    if (document.getElementById('mp-adhide')) return;
    const st = document.createElement('style');
    st.id = 'mp-adhide';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  };

  // 3) Si aún así aparece un anuncio: silenciarlo, saltarlo al final y pulsar "Omitir"
  let mutedByUs = false;
  setInterval(() => {
    injectCss();
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (video) attach(video);
    const player = document.querySelector('.html5-video-player');
    const adShowing = !!player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
    if (adShowing && video) {
      if (!video.muted) { video.muted = true; mutedByUs = true; }
      if (isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
      document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button')
        .forEach((b) => b.click());
    } else if (mutedByUs && video) {
      video.muted = false;
      mutedByUs = false;
    }
  }, 250);
}

// ---------------------------------------------------------------------------
// Página del escenario: API para stage.js + visualizadores
// ---------------------------------------------------------------------------
if (isStage) {
  let cmdHandler = null;
  const pending = [];
  ipcRenderer.on('player:cmd', (_e, c) => (cmdHandler ? cmdHandler(c) : pending.push(c)));
  let modeHandler = null;
  ipcRenderer.on('stage:mode', (_e, m) => modeHandler && modeHandler(m));

  contextBridge.exposeInMainWorld('stage', {
    onCommand: (cb) => { cmdHandler = cb; while (pending.length) cb(pending.shift()); },
    onMode: (cb) => { modeHandler = cb; },
    state: (s) => ipcRenderer.send('player:state', s),
    event: (e) => ipcRenderer.send('player:event', e),
    dblclick: () => ipcRenderer.send('stage:dblclick'),
    key: (k) => ipcRenderer.send('stage:key', k),
    attachLocal: () => document.querySelectorAll('video.local').forEach(attach),
  });

  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('video.local').forEach(attach);
    const strip = document.getElementById('viz');
    const full = document.getElementById('viz-full');
    const party = document.getElementById('party');
    const cover = document.getElementById('cover');
    if (!strip || !full) return;
    let freq = null;
    let wave = null;
    let hue = 0;
    let smoothBass = 0;
    const fit = (c) => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(c.clientWidth * dpr);
      const h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      return [w, h, dpr];
    };
    const colors = () => {
      const cs = getComputedStyle(document.documentElement);
      return [cs.getPropertyValue('--accent').trim() || '#ff5c8a', cs.getPropertyValue('--accent2').trim() || '#ffb347'];
    };

    const draw = () => {
      requestAnimationFrame(draw);
      const mode = document.body.dataset.viz || 'bars';
      const audioMode = document.body.dataset.mode === 'audio';
      if (!nodes) return;
      if (!freq) { freq = new Uint8Array(nodes.analyser.frequencyBinCount); wave = new Uint8Array(nodes.analyser.fftSize); }
      nodes.analyser.getByteFrequencyData(freq);
      const [c1, c2] = colors();
      smoothBass += (bassNow - smoothBass) * 0.35;

      // Modo fiesta: luces de colores sobre toda la pantalla al ritmo de los graves
      if (party) {
        if (mode === 'party' && audioMode) {
          hue = (hue + 0.6 + smoothBass * 4) % 360;
          const a = 0.12 + smoothBass * 0.55;
          party.style.background = `radial-gradient(circle at 20% 30%, hsla(${hue},95%,60%,${a}) 0%, transparent 45%),
            radial-gradient(circle at 80% 70%, hsla(${(hue + 140) % 360},95%,60%,${a}) 0%, transparent 45%),
            radial-gradient(circle at 50% 110%, hsla(${(hue + 260) % 360},95%,60%,${a * 0.9}) 0%, transparent 55%)`;
        } else party.style.background = '';
      }
      if (cover) cover.style.transform = audioMode && (mode === 'circle' || mode === 'party') ? `scale(${1 + smoothBass * 0.06})` : '';

      // Lienzo grande (círculo)
      const [fw, fh, fdpr] = fit(full);
      const fg = full.getContext('2d');
      fg.clearRect(0, 0, fw, fh);
      if (audioMode && mode === 'circle' && cover) {
        const r = cover.getBoundingClientRect();
        const cx = (r.left + r.width / 2) * fdpr;
        const cy = (r.top + r.height / 2) * fdpr;
        const base = (r.width / 2) * fdpr + 10 * fdpr;
        const N = 120;
        fg.lineCap = 'round';
        for (let i = 0; i < N; i++) {
          const idx = Math.floor(Math.pow(i / N, 1.6) * freq.length * 0.7);
          const v = freq[idx] / 255;
          const len = 6 * fdpr + v * base * 0.55;
          const ang = (i / N) * Math.PI * 2 - Math.PI / 2;
          fg.strokeStyle = i % 2 ? c1 : c2;
          fg.globalAlpha = 0.55 + v * 0.45;
          fg.lineWidth = Math.max(2, (2 * Math.PI * base) / N * 0.55);
          fg.beginPath();
          fg.moveTo(cx + Math.cos(ang) * base, cy + Math.sin(ang) * base);
          fg.lineTo(cx + Math.cos(ang) * (base + len), cy + Math.sin(ang) * (base + len));
          fg.stroke();
        }
        fg.globalAlpha = 1;
      }

      // Franja inferior (barras, onda, fiesta)
      const [w, h, dpr] = fit(strip);
      const g = strip.getContext('2d');
      g.clearRect(0, 0, w, h);
      if (!audioMode || mode === 'circle') return;
      const grad = g.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      if (mode === 'wave') {
        nodes.analyser.getByteTimeDomainData(wave);
        const lg = g.createLinearGradient(0, 0, w, 0);
        lg.addColorStop(0, c1); lg.addColorStop(1, c2);
        g.lineWidth = 3 * dpr;
        g.strokeStyle = lg;
        g.shadowColor = c1;
        g.shadowBlur = 14 * dpr;
        g.beginPath();
        const step = Math.max(1, Math.floor(wave.length / w));
        for (let x = 0, i = 0; x < w; x++, i += step) {
          const v = (wave[Math.min(i, wave.length - 1)] - 128) / 128;
          const y = h / 2 + v * h * 0.45 * (1 + smoothBass);
          if (x) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.stroke();
        g.shadowBlur = 0;
        return;
      }
      // barras (también en modo fiesta)
      g.fillStyle = grad;
      const bars = 72;
      const gap = 3 * dpr;
      const bw = (w - gap * (bars - 1)) / bars;
      for (let i = 0; i < bars; i++) {
        // escala logarítmica para repartir graves y agudos
        const lo = Math.floor(Math.pow(freq.length * 0.75, i / bars));
        const hi = Math.max(lo + 1, Math.floor(Math.pow(freq.length * 0.75, (i + 1) / bars)));
        let v = 0;
        for (let j = lo; j < hi; j++) v = Math.max(v, freq[j]);
        const bh = Math.max(2 * dpr, (v / 255) * h * 0.95);
        if (mode === 'party') g.fillStyle = `hsl(${(hue + i * 5) % 360},95%,62%)`;
        g.beginPath();
        g.roundRect(i * (bw + gap), h - bh, bw, bh, Math.min(bw / 2, 4 * dpr));
        g.fill();
      }
    };
    draw();
  });
}
})();
