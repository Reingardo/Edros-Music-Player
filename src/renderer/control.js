// Ventana de control: biblioteca, búsqueda (local + YouTube), carpetas, cola, reproductor, ecualizador,
// favoritos, estadísticas, letras, temporizador, ajustes (idioma, tema, reproducción, control remoto, mascota).
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = window.icon;
  window.hydrateIcons();

  const lib = await window.mp.getLibrary();
  const mp = window.mp;
  const ORIGIN = lib.origin;
  const TOKEN = lib.token;

  const S = {
    tracks: lib.tracks,
    sources: lib.sources,
    folders: lib.folders,
    settings: lib.settings,
    favorites: lib.favorites || [],
    stats: lib.stats || {},
    recent: lib.recent || [],
    view: 'all',
    folderId: null,
    scope: 'local',
    query: '',
    localQuery: '',
    yt: { query: '', items: [], more: false, loading: false, error: null },
    queue: [],
    qIndex: -1,
    queueFolder: null,
    history: [],
    current: null,
    player: { id: null, time: 0, duration: 0, paused: true, buffering: false },
    playerAt: 0,
    selection: new Set(),
    anchor: null,
    visible: [],
    openFolders: new Set(),
    scan: null,
    errorsInRow: 0,
    dual: false,
    modalOpen: false,
    seeking: false,
    sleep: null,
    miniOn: false,
  };
  const D = {
    lang: 'es', theme: 'sunset', mascot: true, mascotAcc: 'none', crossfade: 0, radio: false, notifications: true,
    viz: 'bars', stageLyrics: true, customPresets: {},
  };
  for (const [k, v] of Object.entries(D)) if (S.settings[k] === undefined) S.settings[k] = v;

  // ---------------------------------------------------------------- idioma
  let t = window.I18N.make(S.settings.lang);
  function applyStatic() {
    document.documentElement.lang = S.settings.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    $('search').placeholder = S.scope === 'youtube' ? t('search.phYT') : t('search.phLocal');
  }

  const byId = new Map();
  const reg = (it) => { byId.set(it.id, it); return it; };
  S.tracks.forEach(reg);
  S.folders.forEach((f) => f.items.forEach((it) => { if (!byId.has(it.id)) reg(it); }));
  const resolve = (it) => (it.type === 'local' ? byId.get(it.id) || it : it);

  // ---------------------------------------------------------------- utilidades
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }
  function fmtTotal(sec) {
    if (sec > 0 && sec < 60) return `${Math.round(sec)} s`;
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  function matches(it, q) {
    if (!q) return true;
    const hay = norm(`${it.title} ${it.artist} ${it.album} ${it.path || ''}`);
    return norm(q).split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok));
  }
  const mediaUrl = (tr) => `${ORIGIN}/media?t=${TOKEN}&p=${encodeURIComponent(tr.path)}`;
  const coverUrl = (tr) => `${ORIGIN}/cover?t=${TOKEN}&p=${encodeURIComponent(tr.path)}${tr.coverV ? '&v=' + tr.coverV : ''}`;
  const artOf = (it) => (!it ? '' : it.type === 'youtube' ? it.thumb : it.hasCover ? coverUrl(it) : '');
  const isYTUrl = (s) => /(youtube\.com\/|youtu\.be\/)/i.test(s);

  function toast(msg, err = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  // si una carátula no existe, se quita la imagen y queda el icono de respaldo
  document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG' && e.target.closest('.thumb, .now-art')) e.target.remove();
  }, true);

  function thumb(it, extra = '') {
    if (it.type === 'youtube') return `<div class="thumb wide ${extra}"><img src="${esc(it.thumb)}" loading="lazy" alt=""></div>`;
    const ic = icon(it.media === 'video' ? 'film' : 'music');
    const img = it.hasCover ? `<img src="${esc(coverUrl(it))}" loading="lazy" alt="">` : '';
    return `<div class="thumb ${it.media === 'video' ? 'wide' : ''} ${extra}">${ic}${img}</div>`;
  }

  function badge(it) {
    if (it.type === 'youtube') return it.live ? `<span class="badge live">${t('badge.live')}</span>` : '<span class="badge yt">YT</span>';
    if (it.media === 'video') return `<span class="badge vid">${esc(it.ext)}</span>`;
    return `<span class="badge">${esc(it.ext)}</span>`;
  }

  // ---------------------------------------------------------------- persistencia
  let settingsTimer = null;
  const SETTING_KEYS = ['volume', 'muted', 'shuffle', 'repeat', 'lang', 'theme', 'mascot', 'mascotPos', 'mascotAcc',
    'crossfade', 'radio', 'notifications', 'viz', 'stageLyrics', 'customPresets'];
  function saveSettings() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      const out = {};
      for (const k of SETTING_KEYS) out[k] = S.settings[k];
      mp.saveSettings(out);
    }, 300);
  }
  const saveFolders = () => mp.saveFolders(S.folders);
  let dataTimer = null;
  function saveData(now = false) {
    clearTimeout(dataTimer);
    const go = () => mp.saveData({ favorites: S.favorites, stats: S.stats, recent: S.recent });
    if (now) go(); else dataTimer = setTimeout(go, 2000);
  }

  // ---------------------------------------------------------------- modal
  function modal({ title, text = '', value = '', input = true, ok, danger = false, placeholder = '' }) {
    return new Promise((res) => {
      S.modalOpen = true;
      sendBounds();
      $('modal').hidden = false;
      $('modal-title').textContent = title;
      $('modal-text').textContent = text;
      const inp = $('modal-input');
      inp.hidden = !input;
      inp.value = value;
      inp.placeholder = placeholder;
      $('modal-ok').textContent = ok || t('modal.ok');
      $('modal-ok').style.background = danger ? '#d8445f' : '';
      setTimeout(() => (input ? (inp.focus(), inp.select()) : $('modal-ok').focus()), 30);
      const close = (v) => {
        $('modal').hidden = true;
        S.modalOpen = false;
        sendBounds();
        $('modal-form').onsubmit = null;
        $('modal-cancel').onclick = null;
        $('modal').onmousedown = null;
        document.removeEventListener('keydown', onKey, true);
        res(v);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
      document.addEventListener('keydown', onKey, true);
      $('modal-form').onsubmit = (e) => {
        e.preventDefault();
        if (input) { const v = inp.value.trim(); if (v) close(v); } else close(true);
      };
      $('modal-cancel').onclick = () => close(null);
      $('modal').onmousedown = (e) => { if (e.target.id === 'modal') close(null); };
    });
  }

  // ---------------------------------------------------------------- carpetas
  const folderById = (id) => S.folders.find((f) => f.id === id);
  const childrenOf = (pid) => S.folders.filter((f) => (f.parentId || null) === (pid || null))
    .sort((a, b) => a.name.localeCompare(b.name, S.settings.lang, { numeric: true }));
  function descendants(id) {
    const out = [];
    const walk = (pid) => childrenOf(pid).forEach((c) => { out.push(c.id); walk(c.id); });
    walk(id);
    return out;
  }
  function pathOf(id) {
    const out = [];
    let f = folderById(id);
    while (f) { out.unshift(f); f = folderById(f.parentId); }
    return out;
  }
  const newFolderId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function createFolder(parentId = null, itemsToAdd = null) {
    const parent = parentId ? folderById(parentId) : null;
    const name = await modal({
      title: parent ? t('folder.newSubIn', { name: parent.name }) : t('folder.new'),
      text: t('folder.newHint'),
      ok: t('folder.create'),
    });
    if (!name) return null;
    const f = { id: newFolderId(), name, parentId: parentId || null, items: [], created: Date.now() };
    S.folders.push(f);
    if (parentId) S.openFolders.add(parentId);
    if (itemsToAdd) addToFolder(f.id, itemsToAdd, true);
    saveFolders();
    renderTree();
    if (S.view === 'folder') renderView();
    return f;
  }

  function slim(it) {
    const { id, type, path, media, ext, title, artist, album, duration, hasCover, videoId, thumb: th, live, genre, coverV } = it;
    return { id, type, path, media, ext, title, artist, album, duration, hasCover, videoId, thumb: th, live, genre, coverV };
  }

  function addToFolder(fid, items, silent = false) {
    const f = folderById(fid);
    if (!f) return;
    let added = 0;
    for (const it of items) {
      if (!f.items.some((x) => x.id === it.id)) { f.items.push(slim(it)); added++; }
    }
    saveFolders();
    renderTree();
    if (S.view === 'folder' && S.folderId === fid) renderView();
    if (!silent || added) toast(added ? t('folder.added', { n: added, name: f.name }) : t('folder.already', { name: f.name }));
    if (added && S.settings.mascot) Mascot.react('wow');
  }

  function removeFromFolder(fid, ids) {
    const f = folderById(fid);
    if (!f) return;
    f.items = f.items.filter((x) => !ids.has(x.id));
    S.selection.clear();
    saveFolders();
    renderTree();
    renderView();
  }

  async function renameFolder(id) {
    const f = folderById(id);
    const name = await modal({ title: t('folder.rename'), value: f.name, ok: t('modal.save') });
    if (!name) return;
    f.name = name;
    saveFolders();
    renderTree();
    if (S.view === 'folder') renderView();
  }

  async function deleteFolder(id) {
    const f = folderById(id);
    const sub = descendants(id);
    const ok = await modal({
      title: t('folder.deleteQ', { name: f.name }),
      text: sub.length ? t('folder.deleteSubs', { n: sub.length }) : t('folder.deleteOnly'),
      input: false, ok: t('folder.delete'), danger: true,
    });
    if (!ok) return;
    const kill = new Set([id, ...sub]);
    S.folders = S.folders.filter((x) => !kill.has(x.id));
    saveFolders();
    if (S.view === 'folder' && kill.has(S.folderId)) setView('all');
    renderTree();
  }

  function moveFolder(id, newParent) {
    if (id === newParent || descendants(id).includes(newParent)) return toast(t('folder.cantMove'), true);
    const f = folderById(id);
    f.parentId = newParent || null;
    if (newParent) S.openFolders.add(newParent);
    saveFolders();
    renderTree();
    if (S.view === 'folder') renderView();
  }

  function renderTree() {
    const tree = $('folder-tree');
    const rows = [];
    const walk = (pid, depth) => {
      for (const f of childrenOf(pid)) {
        const kids = childrenOf(f.id).length;
        const open = S.openFolders.has(f.id);
        rows.push(`
          <div class="f-row ${S.view === 'folder' && S.folderId === f.id ? 'on' : ''}" style="--depth:${depth}" data-fid="${f.id}" draggable="true" title="${esc(f.name)}">
            <span class="caret ${kids ? (open ? 'open' : '') : 'none'}" data-act="caret">${icon('chevron')}</span>
            <span class="fi">${icon('folder')}</span>
            <span class="name">${esc(f.name)}</span>
            <span class="n">${f.items.length || ''}</span>
            <span class="acts">
              <button class="icon-btn sm" data-act="sub" title="${esc(t('folder.newSub'))}">${icon('folderPlus')}</button>
              <button class="icon-btn sm" data-act="rename" title="${esc(t('folder.rename'))}">${icon('edit')}</button>
              <button class="icon-btn sm" data-act="delete" title="${esc(t('folder.delete'))}">${icon('trash')}</button>
            </span>
          </div>`);
        if (kids && open) walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    tree.innerHTML = rows.length ? rows.join('') : `<div class="tree-empty">${esc(t('folder.treeEmpty'))}</div>`;
  }

  $('btn-new-folder').onclick = () => createFolder(null);
  $('btn-import-pl').onclick = () => importPlaylist();

  $('folder-tree').addEventListener('click', (e) => {
    const row = e.target.closest('.f-row');
    if (!row) return;
    const id = row.dataset.fid;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'caret') { S.openFolders.has(id) ? S.openFolders.delete(id) : S.openFolders.add(id); return renderTree(); }
    if (act === 'sub') return createFolder(id);
    if (act === 'rename') return renameFolder(id);
    if (act === 'delete') return deleteFolder(id);
    openFolder(id);
  });

  function openFolder(id) {
    S.openFolders.add(id);
    pathOf(id).forEach((p) => S.openFolders.add(p.id));
    S.folderId = id;
    setView('folder');
  }

  // Importar una lista de reproducción de YouTube como carpeta
  async function importPlaylist(url) {
    url ||= await modal({ title: t('pl.import'), text: t('pl.importText'), ok: t('pl.importOk'), placeholder: 'https://www.youtube.com/playlist?list=…' });
    if (!url) return;
    toast(t('pl.loading'));
    const r = await mp.ytPlaylist(url);
    if (r.error) return toast(r.error === 'badUrl' ? t('pl.badUrl') : t('pl.failed'), true);
    if (!r.items.length) return toast(t('pl.empty'), true);
    r.items.forEach(reg);
    const f = { id: newFolderId(), name: r.title, parentId: null, items: r.items.map(slim), created: Date.now(), source: url };
    S.folders.push(f);
    saveFolders();
    toast(t('pl.imported', { n: r.items.length, name: r.title }));
    if (S.settings.mascot) Mascot.react('wow');
    openFolder(f.id);
  }

  // arrastrar pistas / carpetas sobre carpetas
  const DRAG_ITEMS = 'application/x-mp-items';
  const DRAG_FOLDER = 'application/x-mp-folder';
  function dropTarget(el) { return el.closest('.f-row, .sf-card, .folders-head'); }
  document.addEventListener('dragover', (e) => {
    const tg = dropTarget(e.target);
    const types = e.dataTransfer.types;
    if (tg && (types.includes(DRAG_ITEMS) || types.includes(DRAG_FOLDER))) {
      if (tg.classList.contains('folders-head') && !types.includes(DRAG_FOLDER)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = types.includes(DRAG_FOLDER) ? 'move' : 'copy';
      document.querySelectorAll('.drop').forEach((x) => x !== tg && x.classList.remove('drop'));
      tg.classList.add('drop');
    }
  });
  document.addEventListener('dragleave', (e) => {
    const tg = dropTarget(e.target);
    if (tg && !tg.contains(e.relatedTarget)) tg.classList.remove('drop');
  });
  document.addEventListener('drop', (e) => {
    const tg = dropTarget(e.target);
    document.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    if (!tg) return;
    const fid = tg.dataset.fid || null;
    const fdrag = e.dataTransfer.getData(DRAG_FOLDER);
    if (fdrag) { e.preventDefault(); return moveFolder(fdrag, fid); }
    const raw = e.dataTransfer.getData(DRAG_ITEMS);
    if (raw && fid) {
      e.preventDefault();
      const items = JSON.parse(raw).map((id) => S.visible.find((x) => x.id === id) || byId.get(id)).filter(Boolean);
      addToFolder(fid, items);
    }
  });
  $('folder-tree').addEventListener('dragstart', (e) => {
    const row = e.target.closest('.f-row');
    if (row) { e.dataTransfer.setData(DRAG_FOLDER, row.dataset.fid); e.dataTransfer.effectAllowed = 'move'; }
  });

  // ---------------------------------------------------------------- favoritos
  let FAV = new Set(S.favorites.map((f) => f.id));
  const isFav = (id) => FAV.has(id);
  function toggleFav(items) {
    if (!items.length) return;
    const allFav = items.every((i) => FAV.has(i.id));
    if (allFav) S.favorites = S.favorites.filter((f) => !items.some((i) => i.id === f.id));
    else for (const it of items) if (!FAV.has(it.id)) S.favorites.unshift(slim(it));
    FAV = new Set(S.favorites.map((f) => f.id));
    saveData(true);
    toast(allFav ? t('fav.removed', { n: items.length }) : t('fav.added', { n: items.length }));
    if (!allFav && S.settings.mascot) Mascot.react('wow');
    document.querySelectorAll('#view .t-row').forEach((r) => {
      const b = r.querySelector('[data-act="fav"]');
      if (b) { const on = isFav(r.dataset.id); b.classList.toggle('on', on); b.innerHTML = icon(on ? 'heartFill' : 'heart'); }
    });
    counts();
    renderPlayer();
    publish();
    if (S.view === 'favorites') renderView();
  }

  // ---------------------------------------------------------------- navegación
  const PAGE_VIEWS = ['eq', 'settings', 'stats', 'lyrics'];
  function setView(v) {
    // cada sección conserva su propia búsqueda (YouTube vs. biblioteca local)
    if (v === 'youtube' && S.view !== 'youtube') { S.localQuery = S.query; S.query = S.yt.query || ''; $('search').value = S.query; }
    else if (S.view === 'youtube' && v !== 'youtube' && !PAGE_VIEWS.includes(v)) { S.query = S.localQuery || ''; $('search').value = S.query; }
    S.view = v;
    S.selection.clear();
    if (v !== 'youtube' && S.scope === 'youtube' && !PAGE_VIEWS.includes(v)) setScope('local', false);
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $('btn-settings').classList.toggle('on', v === 'settings');
    $('btn-lyrics').classList.toggle('on', v === 'lyrics');
    renderTree();
    renderView();
    $('view').scrollTop = 0;
    if (v === 'lyrics' && S.current && LY.id !== S.current.id) loadLyrics(S.current);
  }
  document.querySelectorAll('.nav-item').forEach((b) => (b.onclick = () => {
    if (b.dataset.view === 'youtube') setScope('youtube', false);
    setView(b.dataset.view);
  }));
  $('btn-settings').onclick = () => setView(S.view === 'settings' ? 'all' : 'settings');

  function setScope(scope, rerender = true) {
    S.scope = scope;
    document.querySelectorAll('#search-scope button').forEach((b) => b.classList.toggle('on', b.dataset.scope === scope));
    $('search').placeholder = scope === 'youtube' ? t('search.phYT') : t('search.phLocal');
    if (!rerender) return;
    if (scope === 'youtube') {
      const q = S.query;
      if (q && q !== S.yt.query) return ytSearch(q);
      setView('youtube');
    } else if (S.view === 'youtube') setView('all');
  }
  document.querySelectorAll('#search-scope button').forEach((b) => (b.onclick = () => setScope(b.dataset.scope)));

  let searchTimer = null;
  $('search').addEventListener('input', (e) => {
    S.query = e.target.value.trim();
    if (S.scope === 'youtube' || isYTUrl(S.query)) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (PAGE_VIEWS.includes(S.view) || S.view === 'sources') setView('all');
      else renderView();
    }, 120);
  });
  $('search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && S.query) {
      if (isYTUrl(S.query)) return openYTLink(S.query);
      if (S.scope === 'youtube') ytSearch(S.query);
      else if (!S.visible.length) setScope('youtube');
    }
    if (e.key === 'Escape') { e.target.value = ''; S.query = ''; if (S.scope === 'local') renderView(); e.target.blur(); }
  });

  // Enlace de YouTube pegado en el buscador: video → se reproduce; lista → se ofrece importarla
  async function openYTLink(url) {
    if (/[?&]list=/.test(url)) {
      const ok = await modal({ title: t('pl.import'), text: t('pl.askImport'), input: false, ok: t('pl.importOk') });
      if (ok) return importPlaylist(url);
    }
    const item = await mp.ytVideo(url);
    if (!item) return toast(t('pl.badUrl'), true);
    reg(item);
    S.yt = { query: item.title, items: [item], more: false, loading: false, error: null };
    $('search').value = '';
    S.query = '';
    if (S.view !== 'youtube') { setScope('youtube', false); setView('youtube'); } else renderView();
    playList([item], 0);
  }

  // ---------------------------------------------------------------- YouTube
  async function ytSearch(q) {
    S.yt = { query: q, items: [], more: false, loading: true, error: null };
    if (S.view !== 'youtube') { setScope('youtube', false); setView('youtube'); } else renderView();
    try {
      const r = await mp.ytSearch(q);
      if (S.yt.query !== q) return;
      S.yt.items = r.items;
      S.yt.more = r.more;
    } catch (err) {
      S.yt.error = 'yt.errSearch';
      console.error(err);
    }
    S.yt.loading = false;
    if (S.view === 'youtube') renderView();
  }

  async function ytMore() {
    if (S.yt.loading) return;
    S.yt.loading = true;
    renderView();
    try {
      const r = await mp.ytMore();
      const seen = new Set(S.yt.items.map((x) => x.id));
      S.yt.items.push(...r.items.filter((x) => !seen.has(x.id)));
      S.yt.more = r.more;
    } catch { toast(t('yt.errMore'), true); }
    S.yt.loading = false;
    renderView();
  }

  // ---------------------------------------------------------------- vistas
  function counts() {
    const music = S.tracks.filter((x) => x.media === 'audio').length;
    $('c-all').textContent = S.tracks.length || '';
    $('c-music').textContent = music || '';
    $('c-videos').textContent = (S.tracks.length - music) || '';
    $('c-fav').textContent = S.favorites.length || '';
  }

  function trackList(items, { inFolder = false, extraCol = null, extraHead = null } = {}) {
    S.visible = items;
    const rows = items.map((it, i) => `
      <div class="t-row ${S.selection.has(it.id) ? 'sel' : ''} ${S.current?.id === it.id ? 'playing' : ''}" data-i="${i}" data-id="${esc(it.id)}" draggable="true">
        <div class="idx"><span class="num">${i + 1}</span><button class="pbtn" data-act="play" title="${esc(t('btn.playThis'))}">${icon('play')}</button></div>
        <div class="t-main">${thumb(it)}
          <div class="t-text">
            <div class="t-title" title="${esc(it.title)}">${esc(it.title)}</div>
            <div class="t-artist">${badge(it)}<span>${esc(it.artist || (it.type === 'youtube' ? '' : t('list.unknownArtist')))}${it.views ? ' · ' + esc(viewsLabel(it.views)) : ''}</span></div>
          </div>
        </div>
        <div class="t-album" title="${esc(it.album)}">${extraCol ? extraCol(it) : esc(it.album)}</div>
        <div class="t-dur r">${it.live ? '' : fmt(it.duration)}</div>
        <div class="t-acts">
          <button class="icon-btn fav ${isFav(it.id) ? 'on' : ''}" data-act="fav" title="${esc(t('btn.fav'))}">${icon(isFav(it.id) ? 'heartFill' : 'heart')}</button>
          <button class="icon-btn" data-act="queue" title="${esc(t('btn.enqueue'))}">${icon('listPlus')}</button>
          <button class="icon-btn" data-act="menu" title="${esc(t('btn.more'))}">${icon('more')}</button>
        </div>
      </div>`).join('');
    return `<div class="tlist">
      <div class="t-head"><div style="text-align:center">#</div><div>${t('list.title')}</div><div>${extraHead || (inFolder ? t('list.albumOrigin') : t('list.album'))}</div><div class="r">${t('list.duration')}</div><div></div></div>
      ${rows}</div>`;
  }
  // "1822 M vistas" → en inglés "1822 M views"
  const viewsLabel = (v) => v.replace(/\bvistas\b/i, t('list.views')).replace(/\bviews\b/i, t('list.views'));

  function emptyLibrary() {
    return `<div class="empty">
      <div class="big">${icon('music')}</div>
      <h2>${t('lib.emptyTitle')}</h2>
      <p>${t('lib.emptyText')}</p>
      <div class="v-actions">
        <button class="btn primary" data-cmd="addSource">${icon('folderPlus')}${t('lib.addFolderLong')}</button>
        <button class="btn ghost" data-cmd="addFiles">${icon('file')}${t('lib.addFiles')}</button>
        <button class="btn ghost" data-cmd="goYT">${icon('youtube')}${t('lib.searchYT')}</button>
      </div></div>`;
  }

  function scanBar() {
    if (!S.scan) return '';
    const pct = S.scan.total ? Math.round((S.scan.done / S.scan.total) * 100) : 0;
    return `<div class="sub">${t('lib.scanning', { done: S.scan.done, total: S.scan.total })}</div><div class="progress"><div style="width:${pct}%"></div></div>`;
  }

  function listHead(title, items, extraActions = '') {
    const total = items.reduce((a, x) => a + (x.duration || 0), 0);
    return `<div class="v-head"><div><h1>${title}</h1>
      <div class="sub">${S.query ? t('lib.results', { n: items.length, q: esc(S.query) }) : `${t('n.items', { n: items.length })}${total ? ' · ' + fmtTotal(total) : ''}`}</div></div>
      <div class="grow"></div>
      <div class="v-actions">
        ${items.length ? `<button class="btn primary" data-cmd="playAll">${icon('play')}${t('btn.playAll')}</button>
        <button class="btn ghost" data-cmd="shuffleAll">${icon('shuffle')}${t('btn.shuffleAll')}</button>` : ''}
        ${extraActions}
      </div></div>`;
  }

  function renderView() {
    const v = $('view');
    counts();
    if (S.view === 'eq') { S.visible = []; return renderEQ(v); }
    if (S.view === 'settings') { S.visible = []; return renderSettings(v); }
    if (S.view === 'sources') { S.visible = []; return renderSources(v); }
    if (S.view === 'stats') return renderStats(v);
    if (S.view === 'lyrics') { S.visible = []; return renderLyricsView(v); }
    if (S.view === 'youtube') return renderYT(v);
    if (S.view === 'folder') return renderFolder(v);
    if (S.view === 'favorites') {
      const items = S.favorites.map(resolve).filter((x) => matches(x, S.query));
      v.innerHTML = listHead(t('nav.favorites'), items) + (items.length ? trackList(items)
        : `<div class="empty"><div class="big">${icon('heart')}</div><h2>${t('fav.emptyTitle')}</h2><p>${t('fav.emptyText')}</p></div>`);
      if (!items.length) S.visible = [];
      return;
    }
    if (S.view === 'recent') {
      const items = S.recent.map(resolve).filter((x) => matches(x, S.query));
      v.innerHTML = listHead(t('nav.recent'), items, S.recent.length ? `<button class="btn ghost danger" data-cmd="clearRecent">${icon('trash')}${t('recent.clear')}</button>` : '')
        + (items.length ? trackList(items) : `<div class="empty"><div class="big">${icon('clock')}</div><h2>${t('recent.emptyTitle')}</h2><p>${t('recent.emptyText')}</p></div>`);
      if (!items.length) S.visible = [];
      return;
    }

    const kind = S.view === 'music' ? 'audio' : S.view === 'videos' ? 'video' : null;
    const all = S.tracks.filter((x) => !kind || x.media === kind);
    const items = all.filter((x) => matches(x, S.query));
    const title = { all: t('lib.allTitle'), music: t('nav.music'), videos: t('nav.videos') }[S.view];
    let html = listHead(title, items, `<button class="btn ghost" data-cmd="addSource">${icon('folderPlus')}${t('lib.addFolder')}</button>`) + scanBar();
    if (S.query) html += `<div class="yt-search-hint" data-cmd="ytFromLocal">${icon('youtube')}<span>${t('lib.searchQonYT', { q: esc(S.query) })}</span></div>`;
    if (!S.tracks.length && !S.scan) html += emptyLibrary();
    else if (!items.length) html += `<div class="empty"><h2>${t('lib.noResults')}</h2><p>${kind === 'video' ? t('lib.noVideos') : t('lib.noSongs')}</p></div>`;
    else html += trackList(items);
    v.innerHTML = html;
  }

  function renderYT(v) {
    const y = S.yt;
    let html = `<div class="v-head"><div><h1>YouTube</h1>
      <div class="sub">${y.query ? t('yt.resultsFor', { q: esc(y.query) }) : t('yt.sub')}</div></div>
      <div class="grow"></div><div class="v-actions"><button class="btn ghost" data-cmd="importPl">${icon('listPlus')}${t('pl.import')}</button></div></div>`;
    if (!y.query) {
      S.visible = [];
      html += `<div class="empty"><div class="big" style="color:#ff5b5b">${icon('youtube')}</div><h2>${t('yt.emptyTitle')}</h2><p>${t('yt.emptyText')}</p></div>`;
    } else if (y.error) {
      S.visible = [];
      html += `<div class="empty"><h2>${t('yt.errTitle')}</h2><p>${t(y.error)}</p><button class="btn ghost" data-cmd="ytRetry">${icon('refresh')}${t('btn.retry')}</button></div>`;
    } else if (y.loading && !y.items.length) {
      S.visible = [];
      html += `<div class="loading"><div class="spinner"></div>${t('yt.searching')}</div>`;
    } else if (!y.items.length) {
      S.visible = [];
      html += `<div class="empty"><h2>${t('lib.noResults')}</h2><p>${t('yt.tryOther')}</p></div>`;
    } else {
      html += trackList(y.items);
      if (y.more) html += `<div class="more-row">${y.loading ? '<div class="spinner"></div>' : `<button class="btn ghost" data-cmd="ytMore">${t('yt.more')}</button>`}</div>`;
    }
    v.innerHTML = html;
  }

  function presetOptions(selected) {
    const custom = Object.keys(S.settings.customPresets || {});
    return `<option value="">${esc(t('folder.eqNone'))}</option>`
      + Object.keys(PRESETS).map((k) => `<option value="${k}" ${selected === k ? 'selected' : ''}>${esc(t('preset.' + k))}</option>`).join('')
      + custom.map((n) => `<option value="c:${esc(n)}" ${selected === 'c:' + n ? 'selected' : ''}>${esc(n)}</option>`).join('');
  }

  function renderFolder(v) {
    const f = folderById(S.folderId);
    if (!f) return setView('all');
    const crumbs = pathOf(f.id);
    const subs = childrenOf(f.id);
    const items = f.items.map(resolve).filter((x) => matches(x, S.query));
    const total = items.reduce((a, x) => a + (x.duration || 0), 0);
    let html = `<div class="v-head"><div>
      <div class="crumbs">${icon('folder')}<span>${t('nav.myFolders')}</span>${crumbs.slice(0, -1).map((c) => `${icon('chevron')}<button data-open="${c.id}">${esc(c.name)}</button>`).join('')}</div>
      <h1>${esc(f.name)}</h1>
      <div class="sub">${t('n.items', { n: f.items.length })}${subs.length ? ` · ${t('n.subfolders', { n: subs.length })}` : ''}${total ? ' · ' + fmtTotal(total) : ''}</div></div>
      <div class="grow"></div>
      <div class="v-actions">
        ${items.length ? `<button class="btn primary" data-cmd="playAll">${icon('play')}${t('btn.playAll')}</button>
        <button class="btn ghost" data-cmd="shuffleAll">${icon('shuffle')}${t('btn.shuffleAll')}</button>` : ''}
        <label class="folder-eq" title="${esc(t('folder.eqHint'))}">${icon('sliders')}<select class="sel" id="folder-eq">${presetOptions(f.eq || '')}</select></label>
        <button class="btn ghost" data-cmd="subFolder">${icon('folderPlus')}${t('folder.subBtn')}</button>
        <button class="btn ghost" data-cmd="renameFolder">${icon('edit')}${t('folder.renameBtn')}</button>
        <button class="btn ghost danger" data-cmd="deleteFolder" title="${esc(t('folder.delete'))}">${icon('trash')}</button>
      </div></div>`;
    if (subs.length) {
      html += `<div class="subfolders">${subs.map((s) => `
        <div class="sf-card" data-fid="${s.id}" data-open="${s.id}">
          <div class="fi">${icon('folder')}</div>
          <div style="min-width:0"><div class="nm">${esc(s.name)}</div><div class="ct">${t('n.items', { n: s.items.length })}</div></div>
        </div>`).join('')}</div>`;
    }
    if (!f.items.length) {
      S.visible = [];
      html += `<div class="empty"><div class="big" style="color:var(--accent-2)">${icon('folder')}</div><h2>${t('folder.emptyTitle')}</h2><p>${t('folder.emptyText')}</p></div>`;
    } else if (!items.length) {
      S.visible = [];
      html += `<div class="empty"><h2>${t('folder.noResults')}</h2></div>`;
    } else html += trackList(items, { inFolder: true });
    v.innerHTML = html;
    $('folder-eq').onchange = (e) => {
      f.eq = e.target.value || undefined;
      saveFolders();
      toast(f.eq ? t('folder.eqSet', { name: f.name, preset: presetName(f.eq) }) : t('folder.eqCleared'));
      if (S.queueFolder === f.id && f.eq) applyPreset(f.eq);
    };
  }

  function renderSources(v) {
    const countIn = (p) => {
      const pre = p.endsWith('\\') ? p : p + '\\';
      return S.tracks.filter((x) => x.path.startsWith(pre)).length;
    };
    const manual = S.tracks.filter((x) => x.manual).length;
    v.innerHTML = `<div class="v-head"><div><h1>${t('nav.sources')}</h1>
      <div class="sub">${t('src.sub')}</div></div>
      <div class="grow"></div>
      <div class="v-actions">
        <button class="btn primary" data-cmd="addSource">${icon('folderPlus')}${t('lib.addFolder')}</button>
        <button class="btn ghost" data-cmd="addFiles">${icon('file')}${t('lib.addFiles')}</button>
        <button class="btn ghost" data-cmd="rescan" ${S.scan ? 'disabled' : ''}>${icon('refresh')}${t('src.rescan')}</button>
      </div></div>${scanBar()}
      ${S.sources.length ? `<div class="src-list">${S.sources.map((p) => `
        <div class="src-row">${icon('drive')}<div class="p" title="${esc(p)}">${esc(p)}</div><span class="n">${t('n.files', { n: countIn(p) })}</span>
          <button class="icon-btn sm" data-cmd="removeSource" data-path="${esc(p)}" title="${esc(t('src.remove'))}">${icon('x')}</button></div>`).join('')}</div>`
        : `<div class="empty"><div class="big">${icon('drive')}</div><h2>${t('src.emptyTitle')}</h2><p>${t('src.emptyText')}</p></div>`}
      ${manual ? `<div class="sub" style="margin-top:16px">${t('src.manual', { n: manual })}</div>` : ''}`;
  }

  // ---------------------------------------------------------------- estadísticas
  function renderStats(v) {
    const entries = Object.entries(S.stats).map(([id, s]) => ({ id, ...s }));
    const plays = entries.reduce((a, s) => a + (s.n || 0), 0);
    const secs = entries.reduce((a, s) => a + (s.secs || 0), 0);
    const top = entries.filter((s) => s.n > 0 && s.item).sort((a, b) => b.n - a.n || b.secs - a.secs).slice(0, 25);
    const artists = {};
    for (const s of entries) {
      const a = (s.item?.artist || '').trim();
      if (!a || !s.n) continue;
      artists[a] = (artists[a] || 0) + s.n;
    }
    const topArtists = Object.entries(artists).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxA = topArtists[0]?.[1] || 1;
    const items = top.map((s) => resolve(s.item));
    const card = (val, key) => `<div class="stat-card"><div class="v">${val}</div><div class="k">${t(key)}</div></div>`;
    let html = `<div class="v-head"><div><h1>${t('nav.stats')}</h1><div class="sub">${t('stats.sub')}</div></div>
      <div class="grow"></div><div class="v-actions">${items.length ? `<button class="btn primary" data-cmd="playAll">${icon('play')}${t('stats.playTop')}</button>` : ''}
      ${entries.length ? `<button class="btn ghost danger" data-cmd="clearStats">${icon('trash')}${t('stats.clear')}</button>` : ''}</div></div>`;
    if (!plays) {
      S.visible = [];
      v.innerHTML = html + `<div class="empty"><div class="big">${icon('chart')}</div><h2>${t('stats.emptyTitle')}</h2><p>${t('stats.emptyText')}</p></div>`;
      return;
    }
    html += `<div class="stat-cards">
      ${card(plays.toLocaleString(S.settings.lang), 'stats.plays')}
      ${card(fmtTotal(secs), 'stats.time')}
      ${card(entries.filter((s) => s.n).length, 'stats.songs')}
      ${card(Object.keys(artists).length, 'stats.artists')}
    </div>
    <div class="stat-cols"><div><h3>${t('stats.topSongs')}</h3>
      ${trackList(items, { extraHead: t('stats.playsCol'), extraCol: (it) => `<span class="plays">${t('stats.nPlays', { n: S.stats[it.id]?.n || 0 })}</span>` })}</div>
      <div><h3>${t('stats.topArtists')}</h3><div class="artists">${topArtists.map(([a, n], i) => `
        <div class="artist-row"><span class="i">${i + 1}</span><span class="nm">${esc(a)}</span><span class="n">${t('stats.nPlays', { n })}</span>
          <div class="bar"><div style="width:${Math.round((n / maxA) * 100)}%"></div></div></div>`).join('')}</div></div>
    </div>`;
    v.innerHTML = html;
  }

  // ---------------------------------------------------------------- letras
  let LY = { id: null, data: null, loading: false };
  async function loadLyrics(it) {
    if (!it) return;
    LY = { id: it.id, data: null, loading: true };
    if (S.view === 'lyrics') renderView();
    let d = null;
    try { d = await mp.lyrics(slim(it)); } catch { d = { none: true }; }
    if (S.current?.id !== it.id) return;
    LY = { id: it.id, data: d, loading: false };
    mp.cmd({ type: 'lyrics', id: it.id, data: d && !d.none ? { synced: d.synced, plain: d.plain } : null });
    if (S.view === 'lyrics') renderView();
  }
  function renderLyricsView(v) {
    const cur = S.current;
    let html = `<div class="v-head"><div><h1>${t('lyr.title')}</h1><div class="sub">${cur ? esc(`${cur.title}${cur.artist ? ' — ' + cur.artist : ''}`) : t('now.none')}</div></div></div>`;
    if (!cur) html += `<div class="empty"><div class="big">${icon('mic')}</div><h2>${t('lyr.nothing')}</h2></div>`;
    else if (LY.loading || LY.id !== cur.id) html += `<div class="loading"><div class="spinner"></div>${t('lyr.loading')}</div>`;
    else if (!LY.data || LY.data.none) html += `<div class="empty"><div class="big">${icon('mic')}</div><h2>${t('lyr.none')}</h2><p>${t('lyr.noneText')}</p></div>`;
    else if (LY.data.synced?.length) {
      html += `<div class="lyr-view" id="lyr-view">${LY.data.synced.map((l, i) => `<div class="lyr-line" data-i="${i}" data-t="${l.t}"><span>${esc(l.text || '♪')}</span></div>`).join('')}
        <div class="lyr-src">${t('lyr.source', { src: esc(LY.data.source) })}</div></div>`;
    } else html += `<div class="lyr-view"><div class="lyr-plain">${esc(LY.data.plain)}</div><div class="lyr-src">${t('lyr.notSynced')} · ${t('lyr.source', { src: esc(LY.data.source) })}</div></div>`;
    v.innerHTML = html;
    lyrLast = -2;
  }
  let lyrLast = -2;
  let lyrUserScroll = 0;
  $('view').addEventListener('wheel', () => { if (S.view === 'lyrics') lyrUserScroll = performance.now(); }, { passive: true });
  $('view').addEventListener('click', (e) => {
    const line = e.target.closest('.lyr-line');
    if (line && S.current) { mp.cmd({ type: 'seek', time: +line.dataset.t }); lyrUserScroll = 0; }
  });
  (function lyricTick() {
    requestAnimationFrame(lyricTick);
    if (S.view !== 'lyrics' || !LY.data?.synced?.length || LY.id !== S.current?.id) return;
    const now = playerTime() + 0.25;
    const L = LY.data.synced;
    let i = -1;
    for (let k = 0; k < L.length; k++) { if (L[k].t <= now) i = k; else break; }
    if (i === lyrLast) return;
    lyrLast = i;
    document.querySelectorAll('#lyr-view .lyr-line').forEach((el, k) => { el.classList.toggle('cur', k === i); el.classList.toggle('past', k < i); });
    const cur = document.querySelector('#lyr-view .lyr-line.cur');
    if (cur && performance.now() - lyrUserScroll > 4000) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  })();
  function playerTime() {
    const p = S.player;
    return Math.min(p.duration || Infinity, p.time + (p.paused ? 0 : (performance.now() - S.playerAt) / 1000));
  }

  // ---------------------------------------------------------------- editor de información (etiquetas)
  function openTagEditor(tr) {
    const isMp3 = /\.mp3$/i.test(tr.path);
    let coverPath = null;
    $('tag-file').textContent = tr.path;
    $('tag-title').value = tr.title || '';
    $('tag-artist').value = tr.artist || '';
    $('tag-album').value = tr.album || '';
    $('tag-genre').value = tr.genre || '';
    $('tag-note').textContent = isMp3 ? t('tags.noteMp3') : t('tags.noteOther');
    const cov = $('tag-cover');
    cov.style.backgroundImage = tr.hasCover ? `url("${coverUrl(tr)}")` : '';
    cov.classList.toggle('has', !!tr.hasCover);
    cov.disabled = !isMp3;
    cov.onclick = async () => {
      const r = await mp.pickCover();
      if (!r) return;
      coverPath = r.path;
      cov.style.backgroundImage = `url("${r.preview}")`;
      cov.classList.add('has');
    };
    S.modalOpen = true;
    sendBounds();
    $('tag-modal').hidden = false;
    setTimeout(() => $('tag-title').focus(), 30);
    const close = () => { $('tag-modal').hidden = true; S.modalOpen = false; sendBounds(); };
    $('tag-cancel').onclick = close;
    $('tag-modal').onmousedown = (e) => { if (e.target.id === 'tag-modal') close(); };
    $('tag-form').onkeydown = (e) => { if (e.key === 'Escape') close(); };
    $('tag-form').onsubmit = async (e) => {
      e.preventDefault();
      $('tag-ok').disabled = true;
      const r = await mp.saveTags({
        path: tr.path,
        title: $('tag-title').value.trim() || tr.title,
        artist: $('tag-artist').value.trim(),
        album: $('tag-album').value.trim(),
        genre: $('tag-genre').value.trim(),
        coverPath,
      });
      $('tag-ok').disabled = false;
      if (r.error) return toast(t('tags.error', { msg: r.message || '' }), true);
      const fresh = r.track;
      fresh.coverV = Date.now();
      S.tracks = S.tracks.map((x) => (x.id === fresh.id ? fresh : x));
      reg(fresh);
      for (const f of S.folders) f.items = f.items.map((x) => (x.id === fresh.id ? slim(fresh) : x));
      S.favorites = S.favorites.map((x) => (x.id === fresh.id ? slim(fresh) : x));
      S.queue = S.queue.map((x) => (x.id === fresh.id ? fresh : x));
      if (S.current?.id === fresh.id) { S.current = fresh; renderNow(); }
      saveFolders();
      saveData();
      close();
      renderView();
      renderQueue();
      toast(t('tags.saved'));
    };
  }

  // acciones de cabeceras y botones de vistas
  $('view').addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) return openFolder(open.dataset.open);
    const c = e.target.closest('[data-cmd]');
    if (!c) return;
    const cmd = c.dataset.cmd;
    const f = folderById(S.folderId);
    switch (cmd) {
      case 'addSource': return addSource();
      case 'addFiles': return addFiles();
      case 'rescan': return rescan();
      case 'removeSource': {
        const ok = await modal({ title: t('src.removeTitle'), text: `${c.dataset.path}\n\n${t('src.removeText')}`, input: false, ok: t('src.removeOk') });
        if (ok) { S.sources = S.sources.filter((p) => p !== c.dataset.path); updateTracks(await mp.removeSource(c.dataset.path)); }
        return;
      }
      case 'goYT': setScope('youtube'); return $('search').focus();
      case 'ytFromLocal': return ytSearch(S.query);
      case 'ytRetry': return ytSearch(S.yt.query);
      case 'ytMore': return ytMore();
      case 'importPl': return importPlaylist();
      case 'playAll': return playList(S.visible, 0);
      case 'shuffleAll':
        if (!S.settings.shuffle) toggleShuffle();
        return playList(S.visible, Math.floor(Math.random() * S.visible.length));
      case 'subFolder': return createFolder(S.folderId);
      case 'renameFolder': return f && renameFolder(f.id);
      case 'deleteFolder': return f && deleteFolder(f.id);
      case 'clearRecent': S.recent = []; saveData(true); return renderView();
      case 'clearStats': {
        const ok = await modal({ title: t('stats.clear'), text: t('stats.clearText'), input: false, ok: t('stats.clear'), danger: true });
        if (ok) { S.stats = {}; saveData(true); renderView(); }
        return;
      }
    }
  });

  async function addSource() {
    S.scan = { done: 0, total: 0 };
    const tracks = await mp.addSource();
    S.scan = null;
    if (!tracks) return renderView();
    S.sources = (await mp.getLibrary()).sources;
    updateTracks(tracks);
    toast(t('lib.updatedN', { n: tracks.length }));
  }
  async function addFiles() {
    const tracks = await mp.addFiles();
    if (tracks) updateTracks(tracks);
  }
  async function rescan(quiet = false) {
    S.scan = { done: 0, total: 0 };
    if (!quiet) renderView();
    const tracks = await mp.rescan();
    S.scan = null;
    if (quiet && tracks.length === S.tracks.length && S.view !== 'sources') { S.tracks = tracks; tracks.forEach(reg); return; }
    updateTracks(tracks);
    if (!quiet) toast(t('lib.updated'));
  }
  function updateTracks(tracks) {
    S.tracks = tracks;
    tracks.forEach(reg);
    renderView();
  }
  mp.onProgress((p) => {
    S.scan = p;
    if (S.view === 'sources' || ['all', 'music', 'videos'].includes(S.view)) {
      const bar = document.querySelector('.progress > div');
      if (bar && p) {
        bar.style.width = `${p.total ? Math.round((p.done / p.total) * 100) : 0}%`;
        bar.parentElement.previousElementSibling.textContent = t('lib.scanning', { done: p.done, total: p.total });
      } else renderView();
    }
  });
  mp.onTracks((tracks) => updateTracks(tracks));

  // ---------------------------------------------------------------- lista: selección, clic, menú
  function rowItem(row) { return S.visible[+row.dataset.i]; }
  function selectedItems(row) {
    const it = rowItem(row);
    if (!S.selection.has(it.id)) { S.selection = new Set([it.id]); S.anchor = +row.dataset.i; paintSelection(); }
    return S.visible.filter((x) => S.selection.has(x.id));
  }
  function paintSelection() {
    document.querySelectorAll('#view .t-row').forEach((r) => r.classList.toggle('sel', S.selection.has(r.dataset.id)));
  }

  $('view').addEventListener('click', (e) => {
    const row = e.target.closest('.t-row');
    if (!row) return;
    const i = +row.dataset.i;
    const it = S.visible[i];
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') return playList(S.visible, i);
    if (act === 'queue') { enqueue(S.selection.has(it.id) ? selectedItems(row) : [it]); return; }
    if (act === 'fav') return toggleFav(S.selection.has(it.id) ? selectedItems(row) : [it]);
    if (act === 'menu') return openMenu(row);
    if (e.shiftKey && S.anchor != null) {
      const [a, b] = [Math.min(S.anchor, i), Math.max(S.anchor, i)];
      S.selection = new Set(S.visible.slice(a, b + 1).map((x) => x.id));
    } else if (e.ctrlKey) {
      S.selection.has(it.id) ? S.selection.delete(it.id) : S.selection.add(it.id);
      S.anchor = i;
    } else {
      S.selection = new Set([it.id]);
      S.anchor = i;
    }
    paintSelection();
  });
  $('view').addEventListener('dblclick', (e) => {
    const row = e.target.closest('.t-row');
    if (row && !e.target.closest('[data-act]')) playList(S.visible, +row.dataset.i);
  });
  $('view').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.t-row');
    if (!row) return;
    e.preventDefault();
    openMenu(row);
  });
  $('view').addEventListener('dragstart', (e) => {
    const row = e.target.closest('.t-row');
    if (!row) return;
    const items = selectedItems(row);
    e.dataTransfer.setData(DRAG_ITEMS, JSON.stringify(items.map((x) => x.id)));
    e.dataTransfer.effectAllowed = 'copy';
  });

  async function openMenu(row) {
    const items = selectedItems(row);
    const res = await mp.trackMenu({
      folders: S.folders.map(({ id, name, parentId }) => ({ id, name, parentId: parentId || null })),
      inFolder: S.view === 'folder',
      isLocal: items.length === 1 && items[0].type === 'local',
      isFav: items.every((i) => isFav(i.id)),
      count: items.length,
    });
    if (!res) return;
    switch (res.action) {
      case 'play': return items.length === 1 ? playList(S.visible, +row.dataset.i) : playList(items, 0);
      case 'playNext': return playNext(items);
      case 'enqueue': return enqueue(items);
      case 'favorite': return toggleFav(items);
      case 'addToFolder': return addToFolder(res.folderId, items);
      case 'newFolder': return createFolder(null, items);
      case 'removeFromFolder': return removeFromFolder(S.folderId, new Set(items.map((x) => x.id)));
      case 'reveal': return mp.reveal(items[0].path);
      case 'editTags': return openTagEditor(resolve(items[0]));
      case 'lyrics':
        if (S.current?.id !== items[0].id) playList(S.visible, +row.dataset.i);
        return setView('lyrics');
    }
  }

  // ---------------------------------------------------------------- cola y reproducción
  function playList(list, i) {
    if (!list.length) return;
    S.queue = list.map(resolve);
    S.qIndex = Math.max(0, Math.min(i, list.length - 1));
    S.queueFolder = S.view === 'folder' ? S.folderId : null;
    S.history = [];
    playCurrent();
  }

  let playLog = { id: null, counted: false, lastTime: null };
  function playCurrent(startAt = 0, opts = {}) {
    const it = S.queue[S.qIndex];
    if (!it) return;
    const changed = S.current?.id !== it.id;
    S.current = it;
    S.player = { id: it.id, time: startAt, duration: it.duration || 0, paused: false, buffering: true };
    S.playerAt = performance.now();
    playLog = { id: it.id, counted: false, lastTime: null };
    sendVolume();
    mp.cmd({
      type: 'load',
      item: slim(it),
      src: it.type === 'local' ? mediaUrl(it) : undefined,
      cover: it.type === 'local' && it.hasCover ? coverUrl(it) : null,
      autoplay: true,
      startAt,
      crossfade: opts.crossfade || 0,
    });
    // historial
    S.recent = [slim(it), ...S.recent.filter((x) => x.id !== it.id)].slice(0, 100);
    saveData();
    // ecualizador propio de la carpeta
    const fold = S.queueFolder && folderById(S.queueFolder);
    if (fold?.eq && pre().preset !== fold.eq) { applyPreset(fold.eq); toast(t('folder.eqApplied', { preset: presetName(fold.eq) })); }
    // letras
    LY = { id: null, data: null, loading: false };
    if (S.settings.stageLyrics || S.view === 'lyrics') loadLyrics(it);
    // mascota
    if (S.settings.mascot) {
      Mascot.setStyle(Mascot.styleFor(it.genre, `${it.title} ${it.album || ''}`));
      if (changed && Math.random() < 0.5) {
        const list = t('mascot.onTrack');
        Mascot.say(list[Math.floor(Math.random() * list.length)].replace('{title}', it.title.length > 38 ? it.title.slice(0, 36) + '…' : it.title));
      }
    }
    renderNow();
    renderPlayer();
    renderQueue();
    markPlaying();
    updateMascotMood();
    publish();
  }

  function enqueue(items) {
    const wasEmpty = !S.current;
    S.queue.push(...items.map(resolve));
    if (wasEmpty) { S.qIndex = S.queue.length - items.length; playCurrent(); }
    else { renderQueue(); publish(); }
    toast(t('queue.added', { n: items.length }));
  }

  function playNext(items) {
    if (!S.current) return enqueue(items);
    S.queue.splice(S.qIndex + 1, 0, ...items.map(resolve));
    renderQueue();
    publish();
    toast(items.length === 1 ? t('queue.nextOne', { title: items[0].title }) : t('queue.nextMany', { n: items.length }));
  }

  function playNow(item) {
    item = resolve(item);
    reg(item);
    if (!S.current) return playList([item], 0);
    S.queue.splice(S.qIndex + 1, 0, item);
    S.qIndex++;
    playCurrent();
  }

  function pickNext() {
    if (S.settings.shuffle && S.queue.length > 1) {
      let j;
      do j = Math.floor(Math.random() * S.queue.length); while (j === S.qIndex);
      return j;
    }
    if (S.qIndex < S.queue.length - 1) return S.qIndex + 1;
    if (S.settings.repeat === 'all') return 0;
    return -1;
  }

  function stopAtEnd() {
    S.player.paused = true;
    renderPlayer();
    updateMascotMood();
    publish();
  }

  function next(auto = false, opts = {}) {
    if (!S.queue.length) return;
    if (auto && S.sleep?.end) { mp.cmd({ type: 'pause' }); S.sleep = null; renderSleep(); toast(t('sleep.done')); return stopAtEnd(); }
    if (auto && S.settings.repeat === 'one' && !opts.crossfade) return playCurrent();
    const j = pickNext();
    if (j < 0) {
      if (auto && S.settings.radio) return startRadio();
      if (auto) return stopAtEnd();
      return toast(t('queue.end'));
    }
    if (S.settings.shuffle) S.history.push(S.qIndex);
    S.qIndex = j;
    playCurrent(0, opts);
  }

  function prev() {
    if (!S.queue.length) return;
    if (S.player.time > 3) return mp.cmd({ type: 'seek', time: 0 });
    if (S.settings.shuffle && S.history.length) S.qIndex = S.history.pop();
    else if (S.qIndex > 0) S.qIndex--;
    else return mp.cmd({ type: 'seek', time: 0 });
    playCurrent();
  }

  // Modo radio: al acabarse la cola sigue con canciones parecidas de YouTube
  let radioBusy = false;
  async function startRadio() {
    if (radioBusy || !S.current) return stopAtEnd();
    radioBusy = true;
    toast(t('radio.loading'));
    let items = [];
    try {
      items = await mp.ytRadio({ seed: slim(S.current), exclude: [...S.queue.map((x) => x.id), ...S.recent.slice(0, 40).map((x) => x.id)] });
    } catch { /* sin conexión */ }
    radioBusy = false;
    if (!items.length) { toast(t('radio.none'), true); return stopAtEnd(); }
    items.forEach(reg);
    S.queue.push(...items);
    S.qIndex++;
    toast(t('radio.added', { n: items.length }));
    playCurrent();
  }

  function togglePlay() {
    if (!S.current) {
      if (S.queue.length) { S.qIndex = Math.max(0, S.qIndex); return playCurrent(); }
      if (S.visible.length) return playList(S.visible, 0);
      return;
    }
    mp.cmd({ type: 'toggle' });
    S.player.time = playerTime();
    S.playerAt = performance.now();
    S.player.paused = !S.player.paused;
    renderPlayer();
    updateMascotMood();
    publish();
  }

  function renderQueue() {
    const q = $('queue');
    const remaining = Math.max(0, S.queue.length - Math.max(0, S.qIndex) - 1);
    $('q-sub').textContent = S.queue.length ? t('queue.sub', { n: S.queue.length, left: remaining }) : t('queue.empty');
    if (!S.queue.length) {
      q.innerHTML = `<div class="q-empty">${t('queue.hint')}</div>`;
      return;
    }
    q.innerHTML = S.queue.map((it, i) => `
      <div class="q-row ${i === S.qIndex ? 'cur' : ''} ${i < S.qIndex && !S.settings.shuffle ? 'past' : ''}" data-q="${i}" draggable="true">
        ${thumb(it)}
        <div class="t-text"><div class="t-title">${esc(it.title)}</div><div class="t-artist">${badge(it)}<span>${esc(it.artist || '')}</span></div></div>
        <button class="icon-btn sm x" data-act="rm" title="${esc(t('queue.remove'))}">${icon('x')}</button>
      </div>`).join('');
    q.querySelector('.q-row.cur')?.scrollIntoView({ block: 'nearest' });
  }

  $('queue').addEventListener('dblclick', (e) => {
    const r = e.target.closest('.q-row');
    if (r && !e.target.closest('[data-act]')) { S.qIndex = +r.dataset.q; playCurrent(); }
  });
  $('queue').addEventListener('click', (e) => {
    const r = e.target.closest('.q-row');
    if (!r || e.target.closest('[data-act]')?.dataset.act !== 'rm') return;
    const i = +r.dataset.q;
    S.queue.splice(i, 1);
    if (i < S.qIndex) S.qIndex--;
    else if (i === S.qIndex) {
      if (S.queue.length) { S.qIndex = Math.min(S.qIndex, S.queue.length - 1); playCurrent(); return; }
      stopAll();
    }
    renderQueue();
    publish();
  });
  // reordenar la cola arrastrando
  let qDrag = null;
  $('queue').addEventListener('dragstart', (e) => {
    const r = e.target.closest('.q-row');
    if (!r) return;
    qDrag = +r.dataset.q;
    r.classList.add('dragging');
    e.dataTransfer.setData('text/plain', 'q');
    e.dataTransfer.effectAllowed = 'move';
  });
  $('queue').addEventListener('dragover', (e) => {
    if (qDrag == null) return;
    e.preventDefault();
    document.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
    e.target.closest('.q-row')?.classList.add('drop-before');
  });
  $('queue').addEventListener('drop', (e) => {
    if (qDrag == null) return;
    e.preventDefault();
    const r = e.target.closest('.q-row');
    let to = r ? +r.dataset.q : S.queue.length;
    const cur = S.queue[S.qIndex];
    const [moved] = S.queue.splice(qDrag, 1);
    if (qDrag < to) to--;
    S.queue.splice(to, 0, moved);
    S.qIndex = S.queue.indexOf(cur);
    qDrag = null;
    renderQueue();
    publish();
  });
  $('queue').addEventListener('dragend', () => { qDrag = null; document.querySelectorAll('.drop-before, .dragging').forEach((x) => x.classList.remove('drop-before', 'dragging')); });

  function stopAll() {
    mp.cmd({ type: 'stop' });
    S.current = null;
    S.qIndex = -1;
    S.player = { id: null, time: 0, duration: 0, paused: true, buffering: false };
    renderNow(); renderPlayer(); markPlaying(); updateMascotMood(); publish();
  }
  $('btn-clear-queue').onclick = () => { S.queue = []; stopAll(); renderQueue(); };

  function markPlaying() {
    document.querySelectorAll('#view .t-row').forEach((r) => r.classList.toggle('playing', r.dataset.id === S.current?.id));
  }

  // ---------------------------------------------------------------- barra del reproductor
  function renderNow() {
    const it = S.current;
    $('now-title').textContent = it ? it.title : t('now.none');
    $('now-artist').textContent = it ? [it.artist, it.type === 'youtube' ? 'YouTube' : it.album].filter(Boolean).join(' · ') : '';
    const art = $('now-art');
    if (!it) art.innerHTML = '';
    else if (it.type === 'youtube') art.innerHTML = `<img src="${esc(it.thumb)}" alt="">`;
    else art.innerHTML = icon(it.media === 'video' ? 'film' : 'music') + (it.hasCover ? `<img src="${esc(coverUrl(it))}" alt="">` : '');
    document.title = it ? `${it.title} — MusicPlayer` : 'MusicPlayer';
    if (S.view === 'lyrics') renderView();
  }

  function setRangeFill(el) {
    const p = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty('--p', p + '%');
  }

  function renderPlayer() {
    const p = S.player;
    const btn = $('btn-play');
    btn.innerHTML = icon(p.paused ? 'play' : 'pause');
    btn.classList.toggle('loading', !!(p.buffering && !p.paused));
    if (!S.seeking) {
      const seek = $('seek');
      seek.value = p.duration ? Math.round((p.time / p.duration) * 1000) : 0;
      setRangeFill(seek);
      $('t-cur').textContent = fmt(p.time);
    }
    $('t-dur').textContent = S.current?.live ? t('badge.live') : fmt(p.duration);
    $('btn-shuffle').classList.toggle('on', !!S.settings.shuffle);
    const rep = $('btn-repeat');
    rep.classList.toggle('on', S.settings.repeat !== 'off');
    rep.innerHTML = icon(S.settings.repeat === 'one' ? 'repeatOne' : 'repeat');
    rep.title = t('repeat.' + S.settings.repeat) + ' (R)';
    $('btn-prev').disabled = !S.queue.length;
    $('btn-next').disabled = !S.queue.length;
    const fav = $('btn-fav');
    const on = !!S.current && isFav(S.current.id);
    fav.disabled = !S.current;
    fav.classList.toggle('on', on);
    fav.innerHTML = icon(on ? 'heartFill' : 'heart');
  }

  function renderVolume() {
    const v = $('volume');
    v.value = Math.round(S.settings.volume * 100);
    setRangeFill(v);
    $('btn-mute').innerHTML = icon(S.settings.muted || S.settings.volume === 0 ? 'mute' : S.settings.volume < 0.5 ? 'volumeLow' : 'volume');
  }
  function sendVolume(vol = S.settings.volume) { mp.cmd({ type: 'volume', volume: vol, muted: S.settings.muted }); }
  function setVolume(v) {
    S.settings.volume = Math.max(0, Math.min(1, v));
    if (S.settings.volume > 0) S.settings.muted = false;
    sendVolume(); renderVolume(); saveSettings(); publish();
  }
  function toggleMute() { S.settings.muted = !S.settings.muted; sendVolume(); renderVolume(); saveSettings(); publish(); }
  function toggleShuffle() {
    S.settings.shuffle = !S.settings.shuffle; S.history = []; renderPlayer(); renderQueue(); saveSettings(); publish();
    toast(S.settings.shuffle ? t('shuffle.on') : t('shuffle.off'));
  }
  function cycleRepeat() {
    S.settings.repeat = { off: 'all', all: 'one', one: 'off' }[S.settings.repeat] || 'off';
    renderPlayer(); saveSettings(); publish();
  }

  $('btn-play').onclick = togglePlay;
  $('btn-next').onclick = () => next(false);
  $('btn-prev').onclick = prev;
  $('btn-shuffle').onclick = toggleShuffle;
  $('btn-repeat').onclick = cycleRepeat;
  $('btn-mute').onclick = toggleMute;
  $('btn-eq').onclick = () => setView('eq');
  $('btn-fav').onclick = () => S.current && toggleFav([S.current]);
  $('btn-lyrics').onclick = () => setView(S.view === 'lyrics' ? 'all' : 'lyrics');
  $('btn-mini').onclick = async () => { S.miniOn = await mp.setMini(!S.miniOn); $('btn-mini').classList.toggle('on', S.miniOn); publish(); };
  $('volume').addEventListener('input', (e) => setVolume(e.target.value / 100));
  $('seek').addEventListener('input', (e) => {
    S.seeking = true;
    setRangeFill(e.target);
    $('t-cur').textContent = fmt((e.target.value / 1000) * S.player.duration);
  });
  $('seek').addEventListener('change', (e) => {
    const tm = (e.target.value / 1000) * S.player.duration;
    if (S.current && S.player.duration) { mp.cmd({ type: 'seek', time: tm }); S.player.time = tm; S.playerAt = performance.now(); publish(); }
    S.seeking = false;
  });

  // ---------------------------------------------------------------- temporizador para dormir
  let sleepFading = false;
  function renderSleep() {
    const b = $('sleep-badge');
    $('btn-sleep').classList.toggle('on', !!S.sleep);
    if (!S.sleep) { b.textContent = ''; $('btn-sleep').title = t('btn.sleep'); return; }
    if (S.sleep.end) { b.textContent = '1'; $('btn-sleep').title = t('sleep.endTitle'); return; }
    const mins = Math.max(0, Math.ceil((S.sleep.until - Date.now()) / 60000));
    b.textContent = mins;
    $('btn-sleep').title = t('sleep.left', { n: mins });
  }
  $('btn-sleep').onclick = async () => {
    const r = await mp.sleepMenu({ active: !!S.sleep });
    if (r == null) return;
    if (r === 'cancel') { S.sleep = null; toast(t('sleep.cancelled')); }
    else if (r === 'end') { S.sleep = { end: true }; toast(t('sleep.atEnd')); }
    else { S.sleep = { until: Date.now() + r * 60000 }; toast(t('sleep.set', { n: r })); }
    renderSleep();
  };
  setInterval(() => {
    if (!S.sleep?.until) return;
    renderSleep();
    if (Date.now() >= S.sleep.until && !sleepFading) sleepFade();
  }, 1000);
  async function sleepFade() {
    sleepFading = true;
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      sendVolume(S.settings.volume * (1 - i / steps));
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!S.player.paused) togglePlay();
    await new Promise((r) => setTimeout(r, 300));
    sendVolume();
    S.sleep = null;
    sleepFading = false;
    renderSleep();
    toast(t('sleep.done'));
    if (S.settings.mascot) Mascot.setMood('sleep');
  }

  // ---------------------------------------------------------------- estado del reproductor
  let lastPublish = 0;
  mp.onState((s) => {
    if (!S.current || s.id !== S.current.id) return;
    const wasPaused = S.player.paused;
    S.player = { ...S.player, ...s };
    S.playerAt = performance.now();
    if (!S.player.duration && S.current.duration) S.player.duration = S.current.duration;
    renderPlayer();
    if (wasPaused !== S.player.paused) { updateMascotMood(); publish(); }
    else if (performance.now() - lastPublish > 2000) publish();
    // estadísticas: tiempo escuchado y reproducción contada a los 30 s (o a la mitad)
    if (!s.paused && playLog.id === s.id) {
      const st = (S.stats[s.id] ||= { n: 0, secs: 0, last: 0, item: slim(S.current) });
      if (playLog.lastTime != null) {
        const d = s.time - playLog.lastTime;
        if (d > 0 && d < 2) st.secs += d;
      }
      playLog.lastTime = s.time;
      if (!playLog.counted && (s.time >= 30 || (s.duration && s.time >= s.duration * 0.5))) {
        playLog.counted = true;
        st.n++;
        st.last = Date.now();
        st.item = slim(S.current);
        saveData();
      }
    }
  });
  mp.onEvent((ev) => {
    if (!S.current || ev.id !== S.current.id) return;
    if (ev.type === 'playing') { S.errorsInRow = 0; return; }
    if (ev.type === 'ended') return next(true);
    if (ev.type === 'nearEnd') {
      // fundido: solo entre archivos locales
      if (!S.settings.crossfade || S.settings.repeat === 'one' || S.sleep?.end || S.current.type !== 'local') return;
      const j = pickNext();
      if (j < 0 || S.queue[j].type !== 'local') return;
      if (S.settings.shuffle) S.history.push(S.qIndex);
      S.qIndex = j;
      return playCurrent(0, { crossfade: S.settings.crossfade });
    }
    if (ev.type === 'error') {
      S.errorsInRow++;
      toast(`«${S.current.title}»: ${ev.message}`, true);
      if (S.settings.mascot) Mascot.react('sad');
      if (S.errorsInRow < 5 && S.qIndex < S.queue.length - 1) setTimeout(() => next(true), 1500);
      else { S.player.paused = true; renderPlayer(); updateMascotMood(); }
    }
  });

  // Estado compartido con el celular, el mini reproductor y la bandeja de Windows
  function publish() {
    lastPublish = performance.now();
    const th = window.THEMES.list.find((x) => x.id === S.settings.theme) || window.THEMES.list[0];
    const lite = (it) => ({ id: it.id, title: it.title, artist: it.artist, type: it.type, media: it.media, thumb: it.thumb, hasCover: !!it.hasCover, videoId: it.videoId });
    const cur = S.current;
    mp.publish({
      lang: S.settings.lang,
      accent: th.vars['--accent'],
      accent2: th.vars['--accent-2'],
      current: cur ? { ...lite(cur), art: artOf(cur) } : null,
      paused: S.player.paused,
      time: playerTime(),
      duration: S.player.duration,
      volume: S.settings.volume,
      muted: S.settings.muted,
      shuffle: S.settings.shuffle,
      repeat: S.settings.repeat,
      fav: !!cur && isFav(cur.id),
      queue: S.queue.slice(0, 300).map(lite),
      qIndex: S.qIndex,
    });
  }

  // Órdenes que llegan del celular, del mini reproductor, de la bandeja o de la barra de tareas
  mp.onAppCmd((c) => {
    switch (c.action) {
      case 'toggle': return togglePlay();
      case 'next': return next(false);
      case 'prev': return prev();
      case 'seek': if (S.current) { mp.cmd({ type: 'seek', time: +c.time || 0 }); S.player.time = +c.time || 0; S.playerAt = performance.now(); publish(); } return;
      case 'volume': return setVolume(+c.value);
      case 'shuffle': return toggleShuffle();
      case 'fav': return S.current && toggleFav([S.current]);
      case 'jump': if (S.queue[c.index]) { S.qIndex = c.index; playCurrent(); } return;
      case 'play': return c.item && playNow(c.item);
      case 'enqueue': if (c.item) { reg(c.item); enqueue([c.item]); } return;
      case 'miniChanged': S.miniOn = !!c.on; $('btn-mini').classList.toggle('on', S.miniOn); return;
    }
  });

  // ---------------------------------------------------------------- doble pantalla
  function sendBounds() {
    const r = $('stage-slot').getBoundingClientRect();
    mp.stageBounds({ x: r.left, y: r.top, width: r.width, height: r.height, hidden: S.modalOpen || S.dual || r.width === 0 });
  }
  new ResizeObserver(sendBounds).observe($('stage-slot'));
  window.addEventListener('resize', sendBounds);

  function applyDual(on) {
    S.dual = on;
    document.body.classList.toggle('dual', on);
    $('btn-dual').classList.toggle('on', on);
    $('btn-dual').title = on ? t('dual.btnOff') : t('dual.btnOn');
    sendBounds();
  }
  $('btn-dual').onclick = async () => applyDual(await mp.setDual(!S.dual));
  $('btn-single').onclick = async () => applyDual(await mp.setDual(false));
  mp.onDual((m) => {
    applyDual(m.on);
    if (m.on && m.hasSecondDisplay === false) toast(t('dual.noSecond'));
    else if (m.on) toast(t('dual.onToast'));
  });

  // ---------------------------------------------------------------- ecualizador
  const FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const FLAB = ['32', '64', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];
  const PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
    rock: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
    pop: [-1, 1, 3, 4, 3, 1, 0, -1, -1, -1],
    electronic: [6, 5, 2, 0, -2, 1, 0, 2, 4, 5],
    hiphop: [6, 5, 2, 3, -1, -1, 1, 0, 2, 3],
    reggaeton: [7, 6, 3, 1, -1, 0, 1, 2, 3, 3],
    latin: [3, 2, 0, 0, 1, 2, 3, 3, 2, 2],
    vocal: [-2, -2, -1, 1, 3, 4, 4, 3, 1, 0],
    classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
    treble: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
    night: [5, 4, 2, 0, 0, 0, 0, 1, 3, 4],
  };
  // ajustes guardados con el nombre antiguo en español
  const LEGACY_PRESET = { 'Plano': 'flat', 'Bajos potentes': 'bass', 'Rock': 'rock', 'Pop': 'pop', 'Electrónica': 'electronic', 'Hip-Hop': 'hiphop',
    'Reggaetón': 'reggaeton', 'Salsa / Latina': 'latin', 'Voces': 'vocal', 'Clásica': 'classical', 'Agudos': 'treble', 'Volumen bajo': 'night', 'Personalizado': 'custom' };
  const pre = () => S.settings.preamp;
  if (LEGACY_PRESET[pre().preset]) pre().preset = LEGACY_PRESET[pre().preset];

  const presetName = (key) => (key?.startsWith('c:') ? key.slice(2) : t('preset.' + key));
  function applyPreset(key) {
    const p = pre();
    if (key.startsWith('c:')) {
      const c = S.settings.customPresets?.[key.slice(2)];
      if (!c) return;
      p.bands = [...c.bands];
      p.gain = c.gain;
    } else if (PRESETS[key]) p.bands = [...PRESETS[key]];
    else return;
    p.preset = key;
    p.enabled = true;
    pushPreamp();
    if (S.view === 'eq') renderView();
  }

  function pushPreamp() {
    mp.setPreamp(pre());
    updateEqPill();
  }
  function updateEqPill() {
    const p = pre();
    const active = p.enabled !== false && (p.gain !== 0 || p.bands.some((b) => b !== 0));
    $('eq-pill').textContent = active ? (p.gain ? `${p.gain > 0 ? '+' : ''}${p.gain} dB` : 'ON') : '';
    $('btn-eq').classList.toggle('on', active || !!p.normalize);
  }

  let curveCtx = null;
  function drawCurve() {
    const canvas = $('eq-curve');
    if (!canvas) return;
    const cs = getComputedStyle(document.documentElement);
    const col = (n) => cs.getPropertyValue(n).trim();
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    const p = pre();
    const on = p.enabled !== false;
    if (!curveCtx) curveCtx = new OfflineAudioContext(1, 128, 44100);
    const N = 400;
    const freqs = new Float32Array(N);
    for (let i = 0; i < N; i++) freqs[i] = 20 * Math.pow(1000, i / (N - 1));
    const total = new Float32Array(N).fill(on ? p.gain : 0);
    const mag = new Float32Array(N);
    const ph = new Float32Array(N);
    FREQS.forEach((f, i) => {
      const b = curveCtx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking';
      b.frequency.value = f; b.Q.value = 1.1; b.gain.value = on ? p.bands[i] : 0;
      b.getFrequencyResponse(freqs, mag, ph);
      for (let k = 0; k < N; k++) total[k] += 20 * Math.log10(mag[k]);
    });
    const minDb = -18, maxDb = 24;
    const y = (db) => h - ((Math.max(minDb, Math.min(maxDb, db)) - minDb) / (maxDb - minDb)) * h;
    const x = (i) => (i / (N - 1)) * w;
    g.font = `${10 * dpr}px Segoe UI`;
    g.fillStyle = col('--faint');
    g.lineWidth = 1 * dpr;
    for (const db of [-12, -6, 0, 6, 12, 18]) {
      g.beginPath(); g.moveTo(0, y(db)); g.lineTo(w, y(db)); g.strokeStyle = db === 0 ? col('--grid0') : col('--grid'); g.stroke();
      g.fillText(`${db > 0 ? '+' : ''}${db}`, 6 * dpr, y(db) - 3 * dpr);
    }
    [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => {
      const xx = (Math.log(f / 20) / Math.log(1000)) * w;
      g.beginPath(); g.moveTo(xx, 0); g.lineTo(xx, h); g.strokeStyle = col('--grid'); g.stroke();
      g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), xx + 3 * dpr, h - 5 * dpr);
    });
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, col('--accent')); grad.addColorStop(1, col('--accent-2'));
    g.beginPath();
    for (let i = 0; i < N; i++) (i ? g.lineTo : g.moveTo).call(g, x(i), y(total[i]));
    g.strokeStyle = grad; g.lineWidth = 2.5 * dpr; g.stroke();
    g.lineTo(w, y(0)); g.lineTo(0, y(0)); g.closePath();
    g.globalAlpha = 0.1; g.fillStyle = col('--accent'); g.fill(); g.globalAlpha = 1;
  }

  function renderEQ(v) {
    const p = pre();
    const on = p.enabled !== false;
    const dbTxt = (d) => `${d > 0 ? '+' : ''}${Number(d).toFixed(d % 1 ? 1 : 0)} dB`;
    const custom = Object.keys(S.settings.customPresets || {});
    v.innerHTML = `<div class="v-head"><div><h1>${t('eq.title')}</h1>
      <div class="sub">${t('eq.sub')}</div></div></div>
      <div class="eq-wrap ${on ? '' : 'eq-off'}" id="eq-wrap">
        <div class="eq-card">
          <div class="eq-top">
            <label class="switch"><input type="checkbox" id="eq-on" ${on ? 'checked' : ''}><span class="tr"></span><b>${t('eq.enabled')}</b></label>
            <label class="switch"><input type="checkbox" id="eq-lim" ${p.limiter !== false ? 'checked' : ''}><span class="tr"></span>${t('eq.limiter')}</label>
            <label class="switch" title="${esc(t('eq.normalizeHint'))}"><input type="checkbox" id="eq-norm" ${p.normalize ? 'checked' : ''}><span class="tr"></span>${t('eq.normalize')}</label>
            <div style="flex:1"></div>
            <button class="btn ghost" id="eq-save">${icon('save')}${t('eq.savePreset')}</button>
            <button class="btn ghost" id="eq-reset">${icon('refresh')}${t('eq.reset')}</button>
          </div>
          <div class="presets" style="margin-top:16px">${Object.keys(PRESETS).map((n) => `<button class="chip ${p.preset === n ? 'on' : ''}" data-preset="${n}">${esc(t('preset.' + n))}</button>`).join('')}
            ${custom.map((n) => `<button class="chip ${p.preset === 'c:' + n ? 'on' : ''}" data-preset="c:${esc(n)}">★ ${esc(n)}<span class="x" data-del="${esc(n)}" title="${esc(t('eq.deletePreset'))}">✕</span></button>`).join('')}
            ${p.preset === 'custom' ? `<button class="chip on">${t('preset.custom')}</button>` : ''}</div>
        </div>
        <div class="eq-card">
          <canvas id="eq-curve"></canvas>
          <div class="eq-sliders">
            <div class="band pre">
              <div class="db" id="db-pre">${dbTxt(p.gain)}</div>
              <input type="range" class="vrange" id="sl-pre" min="-12" max="18" step="0.5" value="${p.gain}" title="${esc(t('eq.preamp'))}">
              <div class="hz">PREAMP</div>
            </div>
            <div class="eq-sep"></div>
            ${FREQS.map((f, i) => `<div class="band">
              <div class="db" id="db-${i}">${dbTxt(p.bands[i])}</div>
              <input type="range" class="vrange" data-band="${i}" min="-12" max="12" step="0.5" value="${p.bands[i]}" title="${FLAB[i]} Hz">
              <div class="hz">${FLAB[i]}</div></div>`).join('')}
          </div>
        </div>
        <div class="eq-card eq-note">${t('eq.note')}</div>
        <div class="eq-card eq-note adblock-note">${icon('shield')}<div>${t('eq.adblock')}</div></div>
      </div>`;
    requestAnimationFrame(drawCurve);

    $('eq-on').onchange = (e) => { p.enabled = e.target.checked; $('eq-wrap').classList.toggle('eq-off', !p.enabled); pushPreamp(); drawCurve(); };
    $('eq-lim').onchange = (e) => { p.limiter = e.target.checked; pushPreamp(); };
    $('eq-norm').onchange = (e) => { p.normalize = e.target.checked; pushPreamp(); toast(p.normalize ? t('eq.normOn') : t('eq.normOff')); };
    $('eq-reset').onclick = () => { Object.assign(p, { gain: 0, bands: [...PRESETS.flat], preset: 'flat', enabled: true, limiter: true }); pushPreamp(); renderEQ(v); };
    $('eq-save').onclick = async () => {
      const name = await modal({ title: t('eq.savePreset'), text: t('eq.savePresetText'), ok: t('modal.save') });
      if (!name) return;
      S.settings.customPresets = { ...(S.settings.customPresets || {}), [name]: { gain: p.gain, bands: [...p.bands] } };
      p.preset = 'c:' + name;
      pushPreamp();
      saveSettings();
      renderEQ(v);
      toast(t('eq.presetSaved', { name }));
    };
    v.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = async (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        const name = del.dataset.del;
        const cp = { ...S.settings.customPresets };
        delete cp[name];
        S.settings.customPresets = cp;
        if (p.preset === 'c:' + name) p.preset = 'custom';
        saveSettings();
        return renderEQ(v);
      }
      applyPreset(b.dataset.preset);
      renderEQ(v);
    }));
    $('sl-pre').oninput = (e) => {
      p.gain = +e.target.value;
      $('db-pre').textContent = dbTxt(p.gain);
      pushPreamp(); drawCurve();
    };
    v.querySelectorAll('[data-band]').forEach((sl) => (sl.oninput = (e) => {
      const i = +sl.dataset.band;
      p.bands[i] = +e.target.value;
      $('db-' + i).textContent = dbTxt(p.bands[i]);
      if (p.preset !== 'custom') {
        p.preset = 'custom';
        v.querySelectorAll('.chip.on').forEach((c) => c.classList.remove('on'));
      }
      pushPreamp(); drawCurve();
    }));
    // doble clic en un deslizador lo pone a 0
    v.querySelectorAll('.vrange').forEach((sl) => (sl.ondblclick = () => { sl.value = 0; sl.dispatchEvent(new Event('input')); }));
  }

  // ---------------------------------------------------------------- ajustes
  const LANGS = [{ id: 'es', name: 'Español', code: 'ES' }, { id: 'en', name: 'English', code: 'EN' }];
  const ACCS = ['none', 'glasses', 'cap', 'crown', 'bow', 'party'];
  const VIZ = ['bars', 'wave', 'circle', 'party'];

  function renderSettings(v) {
    const cur = S.settings;
    const themeCards = window.THEMES.list.map((th) => {
      const tv = th.vars;
      return `<button class="theme-card ${cur.theme === th.id ? 'on' : ''}" data-theme="${th.id}">
        <div class="tc-preview" style="background:${tv['--bg']}">
          <div class="tc-side" style="background:${tv['--panel']}"></div>
          <div class="tc-main">
            <div class="tc-line" style="background:${tv['--panel-2']};width:90%"></div>
            <div class="tc-line" style="background:${tv['--panel-2']};width:65%"></div>
            <div class="tc-bar" style="background:linear-gradient(90deg,${tv['--accent']},${tv['--accent-2']})"></div>
          </div>
        </div>
        <div class="tc-name"><span>${esc(th.name[cur.lang] || th.name.es)}</span>${icon('check')}</div>
      </button>`;
    }).join('');
    const sw = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="tr"></span></label>`;

    v.innerHTML = `<div class="v-head"><div><h1>${t('set.title')}</h1><div class="sub">${t('set.sub')}</div></div></div>
      <div class="set-wrap">
        <div class="eq-card">
          <div class="set-card-head"><div class="sic">${icon('globe')}</div><div><h3>${t('set.lang')}</h3><p>${t('set.langSub')}</p></div></div>
          <div class="lang-opts">${LANGS.map((l) => `
            <button class="lang-opt ${cur.lang === l.id ? 'on' : ''}" data-lang="${l.id}">
              <span class="flag">${l.code}</span><span class="ln">${l.name}</span>${icon('check', 'chk')}
            </button>`).join('')}</div>
        </div>
        <div class="eq-card">
          <div class="set-card-head"><div class="sic">${icon('palette')}</div><div><h3>${t('set.theme')}</h3><p>${t('set.themeSub')}</p></div></div>
          <div class="themes">${themeCards}</div>
        </div>
        <div class="eq-card">
          <div class="set-card-head"><div class="sic">${icon('radio')}</div><div><h3>${t('set.playback')}</h3><p>${t('set.playbackSub')}</p></div></div>
          <div class="set-row"><div class="lbl"><b>${t('set.crossfade')}</b><span>${t('set.crossfadeSub')}</span></div>
            <input type="range" class="range" id="set-xfade" min="0" max="12" step="1" value="${cur.crossfade}"><span class="val" id="xfade-val">${cur.crossfade ? cur.crossfade + ' s' : t('set.off')}</span></div>
          <div class="set-row"><div class="lbl"><b>${t('set.radio')}</b><span>${t('set.radioSub')}</span></div>${sw('set-radio', cur.radio)}</div>
          <div class="set-row"><div class="lbl"><b>${t('set.notify')}</b><span>${t('set.notifySub')}</span></div>${sw('set-notify', cur.notifications)}</div>
          <div class="set-row"><div class="lbl"><b>${t('set.normalize')}</b><span>${t('eq.normalizeHint')}</span></div>${sw('set-norm', !!pre().normalize)}</div>
        </div>
        <div class="eq-card">
          <div class="set-card-head"><div class="sic">${icon('monitors')}</div><div><h3>${t('set.screen')}</h3><p>${t('set.screenSub')}</p></div></div>
          <div class="set-row"><div class="lbl"><b>${t('set.viz')}</b><span>${t('set.vizSub')}</span></div>
            <div class="seg big" id="set-viz">${VIZ.map((m) => `<button data-viz="${m}" class="${cur.viz === m ? 'on' : ''}">${t('viz.' + m)}</button>`).join('')}</div></div>
          <div class="set-row"><div class="lbl"><b>${t('set.stageLyrics')}</b><span>${t('set.stageLyricsSub')}</span></div>${sw('set-slyr', cur.stageLyrics)}</div>
        </div>
        <div class="eq-card">
          <div class="set-card-head"><div class="sic">${icon('phone')}</div><div><h3>${t('set.remote')}</h3><p>${t('set.remoteSub')}</p></div></div>
          <div class="set-row"><div class="lbl"><b>${t('set.remoteOn')}</b><span>${t('set.remoteOnSub')}</span></div>${sw('set-remote', cur.remote)}</div>
          <div id="remote-box"></div>
        </div>
        <div class="eq-card">
          <div class="set-card-head"><div class="sic">${icon('smile')}</div><div><h3>${t('set.mascot')}</h3><p>${t('set.mascotSub')}</p></div></div>
          <div class="mascot-set">
            <div class="mascot-preview preview-idle" data-acc="${cur.mascotAcc}">${Mascot.svg('pv')}</div>
            <div class="txt">${t('set.mascotText')}</div>
            <label class="switch"><input type="checkbox" id="set-mascot" ${cur.mascot ? 'checked' : ''}><span class="tr"></span><b>${cur.mascot ? t('set.on') : t('set.off')}</b></label>
          </div>
          <div class="set-row" style="margin-top:12px"><div class="lbl"><b>${t('set.acc')}</b><span>${t('set.accSub')}</span></div></div>
          <div class="acc-opts">${ACCS.map((a, i) => `<button class="acc-opt ${cur.mascotAcc === a ? 'on' : ''}" data-acc-pick="${a}"><div data-acc="${a}">${Mascot.svg('acc' + i)}</div>${t('acc.' + a)}</button>`).join('')}</div>
          <div style="margin-top:14px"><button class="btn ghost" id="set-mascot-reset" ${cur.mascot ? '' : 'disabled'}>${icon('refresh')}${t('set.mascotReset')}</button></div>
        </div>
        <div class="eq-card about">
          <b>MusicPlayer 1.2</b><br>${t('set.about')}
        </div>
      </div>`;

    v.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
    v.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => setTheme(b.dataset.theme)));
    $('set-mascot').onchange = (e) => setMascot(e.target.checked);
    $('set-mascot-reset').onclick = () => { S.settings.mascotPos = null; saveSettings(); Mascot.resetPos(); };
    v.querySelectorAll('[data-acc-pick]').forEach((b) => (b.onclick = () => {
      S.settings.mascotAcc = b.dataset.accPick;
      Mascot.setAccessory(S.settings.mascotAcc);
      if (S.settings.mascot) Mascot.react('wow');
      saveSettings();
      renderView();
    }));
    $('set-xfade').oninput = (e) => {
      S.settings.crossfade = +e.target.value;
      setRangeFill(e.target);
      $('xfade-val').textContent = S.settings.crossfade ? S.settings.crossfade + ' s' : t('set.off');
      mp.cmd({ type: 'crossfade', secs: S.settings.crossfade });
      saveSettings();
    };
    setRangeFill($('set-xfade'));
    $('set-radio').onchange = (e) => { S.settings.radio = e.target.checked; saveSettings(); };
    $('set-notify').onchange = (e) => { S.settings.notifications = e.target.checked; saveSettings(); };
    $('set-norm').onchange = (e) => { pre().normalize = e.target.checked; pushPreamp(); };
    v.querySelectorAll('[data-viz]').forEach((b) => (b.onclick = () => {
      S.settings.viz = b.dataset.viz;
      mp.cmd({ type: 'viz', mode: S.settings.viz });
      v.querySelectorAll('[data-viz]').forEach((x) => x.classList.toggle('on', x === b));
      saveSettings();
    }));
    $('set-slyr').onchange = (e) => {
      S.settings.stageLyrics = e.target.checked;
      mp.cmd({ type: 'showLyrics', on: S.settings.stageLyrics });
      if (S.settings.stageLyrics && S.current && LY.id !== S.current.id) loadLyrics(S.current);
      saveSettings();
    };
    $('set-remote').onchange = async (e) => {
      e.target.disabled = true;
      const info = await mp.setRemote(e.target.checked);
      e.target.disabled = false;
      S.settings.remote = !!info;
      renderRemoteBox(info);
    };
    if (cur.remote) mp.remoteInfo().then(renderRemoteBox);
  }

  function renderRemoteBox(info) {
    const box = $('remote-box');
    if (!box) return;
    box.innerHTML = info ? `<div class="qr-box"><img src="${info.qr}" alt="QR">
      <div class="txt">${t('set.remoteHow')}<div class="url" style="margin-top:8px">${esc(info.url)}</div></div></div>` : '';
  }

  function setLang(lang) {
    if (lang === S.settings.lang) return;
    S.settings.lang = lang;
    t = window.I18N.make(lang);
    mp.saveSettings({ lang }); // el proceso principal traduce menús y diálogos
    mp.cmd({ type: 'lang', lang });
    applyStatic();
    renderTree(); renderView(); renderQueue(); renderPlayer(); renderNow(); renderSleep(); applyDual(S.dual);
    publish();
    if (S.settings.mascot) Mascot.say(t('mascot.langChanged'));
  }

  function setTheme(id) {
    S.settings.theme = id;
    const th = window.THEMES.apply(id);
    mp.cmd({ type: 'theme', accent: th.vars['--accent'], accent2: th.vars['--accent-2'] });
    saveSettings();
    publish();
    if (S.view === 'settings') renderView();
    if (S.settings.mascot) Mascot.react('wow');
  }

  function setMascot(on) {
    S.settings.mascot = on;
    Mascot.setEnabled(on);
    saveSettings();
    if (on) { updateMascotMood(true); setTimeout(() => Mascot.say(t('mascot.hello')), 350); }
    if (S.view === 'settings') renderView();
  }

  // ---------------------------------------------------------------- mascota
  let sleepTimer = null;
  function updateMascotMood(force = false) {
    if (!S.settings.mascot && !force) return;
    clearTimeout(sleepTimer);
    const playing = S.current && !S.player.paused;
    if (playing) Mascot.setMood('dance');
    else {
      Mascot.setMood('idle');
      sleepTimer = setTimeout(() => { if (!(S.current && !S.player.paused)) Mascot.setMood('sleep'); }, 25000);
    }
  }
  function mascotOpts() {
    return {
      pos: S.settings.mascotPos,
      phrases: () => t('mascot.poke'),
      wakePhrases: () => t('mascot.wake'),
      onMove: (pos) => { S.settings.mascotPos = pos; saveSettings(); },
      onPoke: () => updateMascotMood(),
    };
  }
  mp.onLevel((lv) => { if (S.settings.mascot) Mascot.level(lv); });

  // ---------------------------------------------------------------- teclado
  function hotkey(k) {
    switch (k) {
      case 'Space': case ' ': case 'MediaPlayPause': return togglePlay();
      case 'MediaStop': if (!S.player.paused) togglePlay(); return;
      case 'MediaNextTrack': return next(false);
      case 'MediaPreviousTrack': return prev();
      case 'ArrowRight': return S.current && mp.cmd({ type: 'seekRel', delta: 5 });
      case 'ArrowLeft': return S.current && mp.cmd({ type: 'seekRel', delta: -5 });
      case 'ArrowUp': return setVolume(S.settings.volume + 0.05);
      case 'ArrowDown': return setVolume(S.settings.volume - 0.05);
      case 'm': case 'M': return toggleMute();
      case 's': case 'S': return toggleShuffle();
      case 'r': case 'R': return cycleRepeat();
      case 'n': case 'N': return next(false);
      case 'p': case 'P': return prev();
      case 'f': case 'F': return S.current && toggleFav([S.current]);
      case 'l': case 'L': return setView(S.view === 'lyrics' ? 'all' : 'lyrics');
    }
  }
  mp.onHotkey(hotkey);
  document.addEventListener('keydown', (e) => {
    if (S.modalOpen) return;
    if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('search').focus(); $('search').select(); return; }
    if (e.ctrlKey && e.key === ',') { e.preventDefault(); return setView('settings'); }
    const tag = e.target.tagName;
    if ((tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey && e.key === 'ArrowRight') { e.preventDefault(); return next(false); }
    if (e.ctrlKey && e.key === 'ArrowLeft') { e.preventDefault(); return prev(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'a' && S.visible.length) {
      e.preventDefault(); S.selection = new Set(S.visible.map((x) => x.id)); return paintSelection();
    }
    if (e.key === 'Delete' && S.view === 'folder' && S.selection.size) return removeFromFolder(S.folderId, new Set(S.selection));
    if (e.key === 'Enter' && S.selection.size && tag !== 'BUTTON') {
      const i = S.visible.findIndex((x) => S.selection.has(x.id));
      if (i >= 0) return playList(S.visible, i);
    }
    const k = e.code === 'Space' ? 'Space' : e.key;
    if (['Space', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(k) && tag !== 'BUTTON') e.preventDefault();
    if (tag === 'BUTTON' && k === 'Space') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    hotkey(k);
  });

  // ---------------------------------------------------------------- soltar archivos desde el Explorador
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dropping'); } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dropping');
    const paths = [...e.dataTransfer.files].map((f) => mp.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    const before = S.tracks.length;
    const tracks = await mp.addPaths(paths);
    updateTracks(tracks);
    const added = tracks.length - before;
    toast(added ? t('drop.added', { n: added }) : t('drop.none'));
  });

  // ---------------------------------------------------------------- inicio
  const th = window.THEMES.apply(S.settings.theme);
  mp.cmd({ type: 'theme', accent: th.vars['--accent'], accent2: th.vars['--accent-2'] });
  mp.cmd({ type: 'lang', lang: S.settings.lang });
  mp.cmd({ type: 'crossfade', secs: S.settings.crossfade });
  mp.cmd({ type: 'viz', mode: S.settings.viz });
  mp.cmd({ type: 'showLyrics', on: S.settings.stageLyrics });
  applyStatic();
  Mascot.mount($('mascot-root'), mascotOpts());
  Mascot.setAccessory(S.settings.mascotAcc);
  Mascot.setEnabled(S.settings.mascot);
  updateMascotMood();
  renderTree();
  setView('all');
  renderVolume();
  renderPlayer();
  renderNow();
  renderQueue();
  renderSleep();
  updateEqPill();
  applyDual(false);
  sendBounds();
  publish();
  if (S.settings.dualScreen) applyDual(await mp.setDual(true));
  if (S.sources.length) rescan(true); // detectar canciones nuevas en las carpetas
})();
