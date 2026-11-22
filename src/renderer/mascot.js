// Tempo: mascota original de MusicPlayer. Baila con la música, se duerme cuando no suena nada
// y se puede arrastrar por la ventana. Se activa/desactiva desde Ajustes.
(() => {
  function svg(uid = 'm') {
    return `
<svg class="tempo" viewBox="0 0 120 132" aria-hidden="true">
  <defs>
    <linearGradient id="${uid}-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/>
    </linearGradient>
    <radialGradient id="${uid}-shine" cx=".34" cy=".28" r=".55">
      <stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse class="t-shadow" cx="60" cy="124" rx="28" ry="5"/>
  <g class="t-bounce">
    <g class="t-feet">
      <ellipse cx="45" cy="113" rx="11" ry="6.5" fill="url(#${uid}-body)"/>
      <ellipse cx="75" cy="113" rx="11" ry="6.5" fill="url(#${uid}-body)"/>
      <ellipse cx="45" cy="113" rx="11" ry="6.5" class="t-dim"/>
      <ellipse cx="75" cy="113" rx="11" ry="6.5" class="t-dim"/>
    </g>
    <g class="t-antenna">
      <path d="M60 26 Q59 14 67 9" class="t-line"/>
      <circle cx="68.5" cy="9" r="4.6" fill="var(--accent-2)"/>
    </g>
    <path d="M60 24 C89 24 101 46 101 71 C101 97 85 113 60 113 C35 113 19 97 19 71 C19 46 31 24 60 24 Z" fill="url(#${uid}-body)"/>
    <path d="M60 24 C89 24 101 46 101 71 C101 97 85 113 60 113 C35 113 19 97 19 71 C19 46 31 24 60 24 Z" fill="url(#${uid}-shine)"/>
    <path d="M21 64 Q21 17 60 17 Q99 17 99 64" class="t-band"/>
    <rect x="9" y="54" width="16" height="28" rx="8" class="t-cup"/>
    <rect x="95" y="54" width="16" height="28" rx="8" class="t-cup"/>
    <rect x="13" y="60" width="5" height="16" rx="2.5" fill="var(--accent-2)"/>
    <rect x="102" y="60" width="5" height="16" rx="2.5" fill="var(--accent-2)"/>
    <g class="t-face">
      <g class="e-open">
        <g class="eye"><ellipse cx="47" cy="65" rx="7.5" ry="9" fill="#fff"/><circle class="pupil" cx="48" cy="66" r="4.3"/><circle cx="49.6" cy="63.8" r="1.5" fill="#fff"/></g>
        <g class="eye"><ellipse cx="73" cy="65" rx="7.5" ry="9" fill="#fff"/><circle class="pupil" cx="74" cy="66" r="4.3"/><circle cx="75.6" cy="63.8" r="1.5" fill="#fff"/></g>
      </g>
      <g class="e-happy"><path d="M40 68 Q47 58 54 68" class="t-stroke"/><path d="M66 68 Q73 58 80 68" class="t-stroke"/></g>
      <g class="e-closed"><path d="M40 65 Q47 71 54 65" class="t-stroke"/><path d="M66 65 Q73 71 80 65" class="t-stroke"/></g>
      <ellipse cx="36" cy="79" rx="6" ry="3.6" class="t-cheek"/>
      <ellipse cx="84" cy="79" rx="6" ry="3.6" class="t-cheek"/>
      <path class="m-smile t-stroke" d="M52 82 Q60 90 68 82"/>
      <g class="m-open"><ellipse cx="60" cy="85" rx="5.5" ry="5" fill="#1b1d24"/><ellipse cx="60" cy="88" rx="3.2" ry="1.8" fill="#ff7a9c"/></g>
      <path class="m-sad t-stroke" d="M53 88 Q60 81 67 88"/>
    </g>
    <g class="acc acc-glasses">
      <rect x="35" y="57" width="23" height="15" rx="6" fill="#121318"/>
      <rect x="62" y="57" width="23" height="15" rx="6" fill="#121318"/>
      <path d="M58 62 Q60 59.5 62 62" fill="none" stroke="#121318" stroke-width="3"/>
      <path d="M39 60 L46 60" stroke="#fff" stroke-opacity=".45" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M66 60 L73 60" stroke="#fff" stroke-opacity=".45" stroke-width="2.2" stroke-linecap="round"/>
    </g>
    <g class="acc acc-cap">
      <path d="M27 38 Q29 12 60 11 Q91 12 93 38 Q60 30 27 38 Z" fill="#23262f"/>
      <path d="M86 35 Q104 31 112 39 Q100 43 88 40 Z" fill="#23262f"/>
      <path d="M38 24 Q60 16 82 24" fill="none" stroke="var(--accent-2)" stroke-width="3.2" stroke-linecap="round"/>
      <circle cx="60" cy="11.5" r="3" fill="var(--accent-2)"/>
    </g>
    <g class="acc acc-crown">
      <path d="M38 30 L41 9 L51 20 L60 5 L69 20 L79 9 L82 30 Z" fill="#ffcf3f" stroke="#e5a600" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="60" cy="22" r="3.2" fill="#ff5c8a"/><circle cx="47" cy="25" r="2.4" fill="#5cc8ff"/><circle cx="73" cy="25" r="2.4" fill="#5cc8ff"/>
    </g>
    <g class="acc acc-bow">
      <path d="M26 33 L14 22 Q10 34 15 42 Z" fill="#ff6fa3"/>
      <path d="M26 33 L38 22 Q42 34 37 42 Z" fill="#ff6fa3"/>
      <circle cx="26" cy="33" r="5" fill="#ff4f8c"/>
    </g>
    <g class="acc acc-party">
      <path d="M46 26 L60 -10 L74 26 Z" fill="var(--accent-2)"/>
      <path d="M49.5 17 L70.5 17 M53 8 L67 8 M56.5 -1 L63.5 -1" stroke="#fff" stroke-opacity=".7" stroke-width="3"/>
      <circle cx="60" cy="-11" r="5" fill="#fff"/>
    </g>
  </g>
</svg>`;
  }

  // Estilo de baile según el género (o palabras del título en YouTube)
  function styleFor(genre = '', title = '') {
    const s = `${genre} ${title}`.toLowerCase();
    if (/rock|metal|punk|grunge|hardcore|thrash/.test(s)) return 'headbang';
    if (/salsa|cumbia|bachata|merengue|latin|latina|samba|tango|mambo|son cubano|vallenato/.test(s)) return 'shimmy';
    if (/ballad|balada|classical|cl[aá]sica|jazz|blues|ambient|lo-?fi|chill|piano|acoustic|ac[uú]stic|bolero|soul|r&b|romantic|sleep|relax/.test(s)) return 'sway';
    return 'bounce';
  }

  let root = null;
  let el = null;
  let bubble = null;
  let enabled = false;
  let mood = 'idle';
  let target = 0;
  let lvl = 0;
  let lastLevelAt = 0;
  let bubbleTimer = null;
  let noteTimer = null;
  let zzzTimer = null;
  let opts = {};

  function mount(container, options) {
    opts = options || {};
    root = container;
    root.innerHTML = `<div class="mascot is-idle" id="mascot" title=""><div class="m-bubble"></div><div class="m-fx"></div>${svg('tempo')}</div>`;
    el = root.querySelector('.mascot');
    bubble = el.querySelector('.m-bubble');
    placeAt(opts.pos);
    setupDrag();
    requestAnimationFrame(tick);
    window.addEventListener('resize', () => placeAt(currentPos()));
  }

  function defaultPos() {
    const cs = getComputedStyle(document.documentElement);
    const rightW = parseInt(cs.getPropertyValue('--right-w'), 10) || 420;
    const playerH = parseInt(cs.getPropertyValue('--player-h'), 10) || 92;
    return { right: rightW + 22, bottom: playerH + 10 };
  }
  function currentPos() {
    return { right: parseFloat(el.style.right) || 0, bottom: parseFloat(el.style.bottom) || 0 };
  }
  function placeAt(pos) {
    const p = pos && Number.isFinite(pos.right) ? pos : defaultPos();
    const w = el.offsetWidth || 96;
    const h = el.offsetHeight || 106;
    el.style.right = Math.max(0, Math.min(window.innerWidth - w, p.right)) + 'px';
    el.style.bottom = Math.max(0, Math.min(window.innerHeight - h, p.bottom)) + 'px';
  }

  function setupDrag() {
    let start = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, pos: currentPos(), moved: false };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 5) return;
      start.moved = true;
      el.classList.add('dragging');
      placeAt({ right: start.pos.right - dx, bottom: start.pos.bottom - dy });
    });
    const end = () => {
      if (!start) return;
      const moved = start.moved;
      start = null;
      el.classList.remove('dragging');
      if (moved) opts.onMove?.(currentPos());
      else poke();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => { placeAt(defaultPos()); opts.onMove?.(null); });
  }

  function poke() {
    const wasAsleep = mood === 'sleep';
    react('wow');
    const list = (wasAsleep ? opts.wakePhrases?.() : opts.phrases?.()) || [];
    if (list.length) say(list[Math.floor(Math.random() * list.length)]);
    if (wasAsleep) setMood('idle');
    opts.onPoke?.();
  }

  function say(text, ms = 3200) {
    if (!el || !enabled || !text) return;
    bubble.textContent = text;
    el.classList.add('talking');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => el.classList.remove('talking'), ms);
  }

  function react(kind) {
    if (!el) return;
    const cls = 'r-' + kind;
    el.classList.remove(cls);
    void el.offsetWidth; // reinicia la animación
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), kind === 'sad' ? 2600 : 900);
  }

  function setMood(m) {
    if (!el || m === mood) return;
    mood = m;
    el.classList.remove('is-idle', 'is-dance', 'is-sleep');
    el.classList.add('is-' + m);
    clearInterval(noteTimer);
    clearInterval(zzzTimer);
    if (m === 'dance') noteTimer = setInterval(() => spawn('note'), 900);
    if (m === 'sleep') zzzTimer = setInterval(() => spawn('zzz'), 1400);
  }

  function spawn(kind) {
    if (!enabled || document.hidden) return;
    const fx = el.querySelector('.m-fx');
    const s = document.createElement('span');
    s.className = 'fx ' + kind;
    s.textContent = kind === 'zzz' ? 'z' : ['♪', '♫', '♬'][Math.floor(Math.random() * 3)];
    s.style.left = (kind === 'zzz' ? 64 : 15 + Math.random() * 70) + '%';
    s.style.setProperty('--dx', ((Math.random() - 0.5) * 40).toFixed(0) + 'px');
    fx.appendChild(s);
    setTimeout(() => s.remove(), 2200);
  }

  function level(v) {
    target = Math.max(0, Math.min(1, v));
    lastLevelAt = performance.now();
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!el || !enabled) return;
    let t = target;
    if (mood === 'dance' && now - lastLevelAt > 600) {
      // sin señal de audio (p. ej. video aún cargando): ritmo simulado
      t = 0.35 + 0.3 * Math.max(0, Math.sin(now / 1000 * Math.PI * 2 * 1.9));
    }
    if (mood !== 'dance') t = 0;
    lvl += (t - lvl) * (t > lvl ? 0.55 : 0.18);
    el.style.setProperty('--lvl', lvl.toFixed(3));
    // los ojos siguen un poco al cursor
  }

  document.addEventListener('pointermove', (e) => {
    if (!el || !enabled || mood === 'sleep') return;
    const r = el.getBoundingClientRect();
    const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 400));
    const dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / 400));
    el.style.setProperty('--look-x', (dx * 2.2).toFixed(2) + 'px');
    el.style.setProperty('--look-y', (dy * 2).toFixed(2) + 'px');
  });

  function setEnabled(on) {
    enabled = !!on;
    if (el) {
      el.classList.toggle('hidden', !enabled);
      if (enabled) { react('wow'); placeAt(currentPos()); }
    }
  }

  function resetPos() { if (el) { placeAt(defaultPos()); react('wow'); } }
  function setAccessory(a) { if (el) el.dataset.acc = a || 'none'; }
  function setStyle(s) { if (el) el.dataset.style = s || 'bounce'; }

  window.Mascot = { mount, setEnabled, setMood, level, say, react, svg, resetPos, setAccessory, setStyle, styleFor, get mood() { return mood; } };
})();
