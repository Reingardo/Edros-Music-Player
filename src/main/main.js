import { app, BrowserWindow, BaseWindow, WebContentsView, ipcMain, dialog, Menu, shell, screen, session, globalShortcut } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Innertube, Log } from 'youtubei.js';
import NodeID3 from 'node-id3';
import { Store } from './store.js';
import { scanFolders, readTrack, mediaKind, readCover, clearCover } from './library.js';
import { startServer } from './server.js';
import { installAdBlock } from './adblock.js';
import { findLyrics } from './lyrics.js';
import { startRemote } from './remote.js';
import { createDesktop } from './desktop.js';

Log.setLevel(Log.Level.NONE);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');
const PRELOAD = path.join(ROOT, 'preload');
const ICON = path.join(ROOT, 'assets', 'icon.png'); // logo Edros

let store;
let srv;
let controlWin = null;
let stageView = null;
let stageWin = null;       // ventana de la segunda pantalla (modo doble pantalla)
let stageRect = { x: 0, y: 0, width: 0, height: 0, hidden: true };
let desktop = null;
let remote = null;
let appState = {};         // último estado del reproductor (para el celular, el mini reproductor y la bandeja)
let quitting = false;
const trackPaths = new Set();

// Textos del proceso principal (menús nativos, diálogos, títulos)
const MAIN_TXT = {
  es: {
    stageTitle: 'MusicPlayer — Pantalla de video', pickFolders: 'Elige carpetas con tu música y videos',
    pickFiles: 'Elige archivos de audio o video', filesFilter: 'Audio y video',
    play: 'Reproducir', pause: 'Pausar', next: 'Siguiente', prev: 'Anterior', mini: 'Mini reproductor', show: 'Mostrar MusicPlayer', quit: 'Salir',
    nowPlaying: 'Ahora suena', playNext: 'Reproducir a continuación', enqueue: 'Añadir a la cola', addTo: 'Añadir a carpeta',
    addToNamed: 'Añadir a «{name}»', newFolder: 'Nueva carpeta…', removeFrom: 'Quitar de esta carpeta', reveal: 'Mostrar en el Explorador',
    favAdd: 'Añadir a favoritos', favRemove: 'Quitar de favoritos', editTags: 'Editar información…', lyrics: 'Ver letra',
    sleepTitle: 'Apagar la música en…', sleepMin: '{n} minutos', sleepEnd: 'Al terminar esta canción', sleepCancel: 'Cancelar temporizador',
    pickCover: 'Elige una imagen para la carátula', images: 'Imágenes',
  },
  en: {
    stageTitle: 'MusicPlayer — Video screen', pickFolders: 'Choose folders with your music and videos',
    pickFiles: 'Choose audio or video files', filesFilter: 'Audio and video',
    play: 'Play', pause: 'Pause', next: 'Next', prev: 'Previous', mini: 'Mini player', show: 'Show MusicPlayer', quit: 'Quit',
    nowPlaying: 'Now playing', playNext: 'Play next', enqueue: 'Add to queue', addTo: 'Add to folder',
    addToNamed: 'Add to “{name}”', newFolder: 'New folder…', removeFrom: 'Remove from this folder', reveal: 'Show in File Explorer',
    favAdd: 'Add to favorites', favRemove: 'Remove from favorites', editTags: 'Edit info…', lyrics: 'Show lyrics',
    sleepTitle: 'Stop the music in…', sleepMin: '{n} minutes', sleepEnd: 'When this song ends', sleepCancel: 'Cancel timer',
    pickCover: 'Choose an image for the cover', images: 'Images',
  },
};
const tm = (k, v = {}) => {
  const d = MAIN_TXT[store?.data.settings.lang] || MAIN_TXT.es;
  return (d[k] ?? MAIN_TXT.es[k]).replace(/\{(\w+)\}/g, (_, n) => v[n] ?? '');
};

function refreshTrackPaths() {
  trackPaths.clear();
  for (const t of store.data.tracks) trackPaths.add(t.path);
}

function applyOverrides(tracks) {
  const ov = store.data.overrides || {};
  for (const t of tracks) if (ov[t.path]) Object.assign(t, ov[t.path]);
  return tracks;
}

function sendControl(channel, payload) {
  if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send(channel, payload);
}

function sendStage(channel, payload) {
  if (stageView && !stageView.webContents.isDestroyed()) stageView.webContents.send(channel, payload);
}

// Envía a todos los frames del escenario (incluido el reproductor de YouTube incrustado)
function sendStageAllFrames(channel, payload) {
  if (!stageView || stageView.webContents.isDestroyed()) return;
  for (const f of stageView.webContents.mainFrame.framesInSubtree) {
    try { f.send(channel, payload); } catch { /* frame cerrado */ }
  }
}

function showMain() {
  if (!controlWin) return;
  if (controlWin.isMinimized()) controlWin.restore();
  controlWin.show();
  controlWin.focus();
}

// ---------- Ventanas ----------
function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: 'MusicPlayer',
    icon: ICON,
    backgroundColor: '#0c0e13',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(PRELOAD, 'control.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  controlWin.loadURL(`${srv.origin}/app/control.html?t=${srv.token}`);

  stageView = new WebContentsView({
    webPreferences: {
      preload: path.join(PRELOAD, 'stage.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegrationInSubFrames: true, // el preload también entra al reproductor de YouTube
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  stageView.setBackgroundColor('#000000');
  stageView.webContents.loadURL(`${srv.origin}/app/stage.html?t=${srv.token}`);
  stageView.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(www\.)?youtube\.com\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  stageView.webContents.on('will-navigate', (e) => e.preventDefault());
  controlWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  controlWin.contentView.addChildView(stageView);
  applyStageBounds();

  controlWin.once('ready-to-show', () => desktop?.refreshThumbar());
  controlWin.on('closed', () => {
    controlWin = null;
    if (stageWin && !stageWin.isDestroyed()) stageWin.destroy();
    quitApp();
  });
}

function quitApp() {
  if (quitting) return;
  quitting = true;
  desktop?.destroy();
  remote?.stop();
  app.quit();
}

function applyStageBounds() {
  if (!stageView || stageWin) return;
  const r = stageRect;
  stageView.setVisible(!r.hidden && r.width > 0 && r.height > 0);
  stageView.setBounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
}

function fitStageWindow() {
  if (!stageWin || stageWin.isDestroyed()) return;
  const { width, height } = stageWin.getContentBounds();
  stageView.setBounds({ x: 0, y: 0, width, height });
}

function setDual(on) {
  if (on && !stageWin) {
    const ctrlDisplay = screen.getDisplayMatching(controlWin.getBounds());
    const other = screen.getAllDisplays().find((d) => d.id !== ctrlDisplay.id);
    const b = other ? other.workArea : null;
    stageWin = new BaseWindow({
      title: tm('stageTitle'),
      icon: ICON,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      ...(b ? { x: b.x, y: b.y, width: b.width, height: b.height } : { width: 1280, height: 720 }),
    });
    controlWin.contentView.removeChildView(stageView);
    stageWin.contentView.addChildView(stageView);
    stageView.setVisible(true);
    fitStageWindow();
    stageWin.on('resize', fitStageWindow);
    stageWin.on('enter-full-screen', fitStageWindow);
    stageWin.on('leave-full-screen', fitStageWindow);
    if (other) stageWin.setFullScreen(true);
    stageWin.on('close', () => {
      // devolvemos el escenario a la ventana de control antes de cerrar
      stageWin.contentView.removeChildView(stageView);
      stageWin = null;
      if (controlWin) {
        controlWin.contentView.addChildView(stageView);
        applyStageBounds();
      }
      store.data.settings.dualScreen = false;
      store.save();
      sendControl('dual:changed', { on: false });
      sendStage('stage:mode', { dual: false });
    });
    store.data.settings.dualScreen = true;
    store.save();
    sendControl('dual:changed', { on: true, hasSecondDisplay: !!other });
    sendStage('stage:mode', { dual: true });
  } else if (!on && stageWin) {
    stageWin.close();
  }
  return !!stageWin;
}

// ---------- YouTube ----------
let yt = null;
let lastSearch = null;
async function getYT() {
  if (!yt) yt = await Innertube.create({ retrieve_player: false, lang: store.data.settings.lang === 'en' ? 'en' : 'es', location: 'US' });
  return yt;
}

function mapVideo(v) {
  const id = v.video_id || v.id;
  if (!id) return null;
  return {
    id: 'y:' + id,
    type: 'youtube',
    videoId: id,
    media: 'video',
    title: v.title?.toString?.() || String(v.title || ''),
    artist: v.author?.name || '',
    album: 'YouTube',
    duration: v.duration?.seconds || 0,
    live: !v.duration?.seconds,
    thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    views: viewsText(v.short_view_count?.toString?.() || v.view_count?.toString?.() || ''),
  };
}

function viewsText(t) {
  if (!t || t === 'N/A' || t.length > 30) return '';
  return /vist|view/i.test(t) ? t : `${t} vistas`;
}

const toSecs = (txt) => (txt || '').split(':').reduce((a, n) => a * 60 + (parseInt(n, 10) || 0), 0);

// Formato nuevo de YouTube ("LockupView")
function mapLockup(x) {
  if (x.content_type && x.content_type !== 'VIDEO') return null;
  const id = x.content_id;
  if (!id) return null;
  const rows = x.metadata?.metadata?.metadata_rows || [];
  const parts = rows.flatMap((r) => r.metadata_parts || []);
  const channel = parts.find((p) => p.avatar_stack?.text?.text)?.avatar_stack.text.text
    || parts.find((p) => p.text?.text)?.text.text || '';
  const views = parts.filter((p) => p.text?.text && p.text.text !== channel).map((p) => p.text.text)[0] || '';
  const badges = (x.content_image?.overlays || []).flatMap((o) => o.badges || []);
  const durTxt = badges.map((b) => b.text).find((t) => /^\d+(:\d{2})+$/.test(t || ''));
  const live = !durTxt && badges.some((b) => /LIVE|VIVO|DIRECTO/i.test(`${b.text} ${b.icon_name}`));
  return {
    id: 'y:' + id,
    type: 'youtube',
    videoId: id,
    media: 'video',
    title: x.metadata?.title?.text || '',
    artist: channel,
    album: 'YouTube',
    duration: toSecs(durTxt),
    live,
    thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    views: viewsText(views),
  };
}

function mapResults(results) {
  const out = [];
  const walk = (arr) => (arr || []).forEach((x) => {
    if (x.type === 'Video' || x.type === 'PlaylistVideo' || x.type === 'CompactVideo') out.push(mapVideo(x));
    else if (x.type === 'LockupView') out.push(mapLockup(x));
    else if (x.contents && Array.isArray(x.contents)) walk(x.contents);
  });
  walk(results);
  const seen = new Set();
  return out.filter((v) => v && v.title && !seen.has(v.id) && seen.add(v.id));
}

async function ytSearchItems(q, limit = 40) {
  const client = await getYT();
  const r = await client.search(String(q).slice(0, 200), { type: 'video' });
  return mapResults(r.results).slice(0, limit);
}

function videoIdFrom(text) {
  const m = String(text).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  return m ? m[1] : null;
}

function searchLocal(q, limit = 40) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const toks = norm(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return store.data.tracks.filter((t) => {
    const hay = norm(`${t.title} ${t.artist} ${t.album} ${t.path}`);
    return toks.every((k) => hay.includes(k));
  }).slice(0, limit);
}

// ---------- Control remoto (celular) ----------
async function setRemote(on) {
  if (on && !remote) {
    store.data.settings.remoteKey ||= crypto.randomBytes(12).toString('hex');
    remote = await startRemote({
      key: store.data.settings.remoteKey,
      rendererDir: RENDERER,
      onCmd: (c) => sendControl('app:cmd', c),
      getState: () => appState,
      search: async (src, q) => {
        try { return src === 'yt' ? await ytSearchItems(q, 20) : searchLocal(q, 40); } catch { return []; }
      },
      getCover: async (id) => {
        const p = id.startsWith('l:') ? id.slice(2) : null;
        return p && trackPaths.has(p) ? readCover(p) : null;
      },
    });
  } else if (!on && remote) {
    remote.stop();
    remote = null;
  }
  store.data.settings.remote = !!remote;
  store.save();
  return remote ? { url: remote.url, qr: remote.qr } : null;
}

// ---------- IPC ----------
function setupIpc() {
  ipcMain.handle('lib:get', () => ({ ...store.data, origin: srv.origin, token: srv.token }));

  ipcMain.handle('lib:addSource', async () => {
    const r = await dialog.showOpenDialog(controlWin, {
      title: tm('pickFolders'),
      properties: ['openDirectory', 'multiSelections'],
    });
    if (r.canceled) return null;
    for (const p of r.filePaths) if (!store.data.sources.includes(p)) store.data.sources.push(p);
    return rescan();
  });

  ipcMain.handle('lib:addFiles', async () => {
    const r = await dialog.showOpenDialog(controlWin, {
      title: tm('pickFiles'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: tm('filesFilter'), extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma', 'mp4', 'webm', 'mkv', 'mov', 'm4v'] }],
    });
    if (r.canceled) return null;
    return addFiles(r.filePaths);
  });

  ipcMain.handle('lib:addPaths', async (_e, paths) => addFiles((paths || []).filter((p) => typeof p === 'string')));

  ipcMain.handle('lib:removeSource', async (_e, p) => {
    store.data.sources = store.data.sources.filter((s) => s !== p);
    const prefix = p.endsWith(path.sep) ? p : p + path.sep;
    store.data.tracks = store.data.tracks.filter((t) => t.manual || !t.path.startsWith(prefix));
    refreshTrackPaths();
    store.save();
    return store.data.tracks;
  });

  ipcMain.handle('lib:rescan', () => rescan());

  // Favoritos, estadísticas y recientes (los calcula la ventana de control)
  ipcMain.handle('data:save', (_e, patch) => {
    for (const k of ['favorites', 'stats', 'recent']) if (patch[k] !== undefined) store.data[k] = patch[k];
    store.save();
    return true;
  });

  // ---- YouTube
  ipcMain.handle('yt:search', async (_e, query) => {
    const client = await getYT();
    lastSearch = await client.search(String(query).slice(0, 200), { type: 'video' });
    return { items: mapResults(lastSearch.results), more: !!lastSearch.has_continuation };
  });

  ipcMain.handle('yt:more', async () => {
    if (!lastSearch?.has_continuation) return { items: [], more: false };
    lastSearch = await lastSearch.getContinuation();
    return { items: mapResults(lastSearch.results), more: !!lastSearch.has_continuation };
  });

  // Un enlace de video pegado en el buscador
  ipcMain.handle('yt:video', async (_e, text) => {
    const id = videoIdFrom(text);
    if (!id) return null;
    let title = id, artist = '';
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
      if (r.ok) { const j = await r.json(); title = j.title || id; artist = j.author_name || ''; }
    } catch { /* sin datos extra */ }
    return { id: 'y:' + id, type: 'youtube', videoId: id, media: 'video', title, artist, album: 'YouTube', duration: 0, thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` };
  });

  // Importar una lista de reproducción de YouTube
  ipcMain.handle('yt:playlist', async (_e, text) => {
    const m = String(text).match(/[?&]list=([\w-]+)/) || String(text).trim().match(/^((?:PL|OL|UU|FL|LL|RD)[\w-]{10,})$/);
    if (!m) return { error: 'badUrl' };
    try {
      const client = await getYT();
      let pl = await client.getPlaylist(m[1]);
      const title = pl.info?.title || 'YouTube';
      let items = mapResults(pl.items);
      while (pl.has_continuation && items.length < 500) {
        pl = await pl.getContinuation();
        items = items.concat(mapResults(pl.items));
      }
      const seen = new Set();
      items = items.filter((v) => !seen.has(v.id) && seen.add(v.id));
      return { title, items };
    } catch (err) {
      return { error: 'failed', message: String(err.message || err).slice(0, 200) };
    }
  });

  // Modo radio: canciones parecidas cuando se acaba la cola
  ipcMain.handle('yt:radio', async (_e, { seed, exclude }) => {
    const skip = new Set(exclude || []);
    let items = [];
    try {
      const client = await getYT();
      if (seed?.type === 'youtube' && seed.videoId) {
        const info = await client.getInfo(seed.videoId);
        items = mapResults(info.watch_next_feed || []);
      }
    } catch { /* probamos con búsqueda */ }
    if (items.filter((i) => !skip.has(i.id)).length < 5) {
      const q = [seed?.artist, seed?.type === 'local' ? '' : ''].filter(Boolean).join(' ') || seed?.title || 'music';
      try { items = items.concat(await ytSearchItems(`${q} mix`, 30)); } catch { /* sin conexión */ }
    }
    const seen = new Set();
    return items.filter((i) => !i.live && i.duration > 60 && i.duration < 1200 && !skip.has(i.id) && !seen.has(i.id) && seen.add(i.id)).slice(0, 15);
  });

  ipcMain.handle('lyrics:get', (_e, item) => findLyrics(item));

  // ---- Editar información de archivos
  ipcMain.handle('tags:pickCover', async () => {
    const r = await dialog.showOpenDialog(controlWin, {
      title: tm('pickCover'),
      properties: ['openFile'],
      filters: [{ name: tm('images'), extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (r.canceled) return null;
    const buf = await fs.readFile(r.filePaths[0]);
    const ext = path.extname(r.filePaths[0]).slice(1).toLowerCase().replace('jpg', 'jpeg');
    return { path: r.filePaths[0], preview: `data:image/${ext};base64,${buf.toString('base64')}` };
  });

  ipcMain.handle('tags:save', async (_e, { path: file, title, artist, album, genre, coverPath }) => {
    if (!trackPaths.has(file)) return { error: 'unknown' };
    const isMp3 = /\.mp3$/i.test(file);
    try {
      if (isMp3) {
        const tags = { title, artist, album, genre };
        if (coverPath) {
          const ext = path.extname(coverPath).toLowerCase();
          tags.image = { mime: ext === '.png' ? 'image/png' : 'image/jpeg', type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: await fs.readFile(coverPath) };
        }
        const ok = NodeID3.update(tags, file);
        if (ok !== true) return { error: 'write', message: String(ok?.message || ok) };
        delete store.data.overrides[file];
      } else {
        store.data.overrides[file] = { title, artist, album, genre };
      }
      clearCover(file);
      const fresh = applyOverrides([await readTrack(file)])[0];
      const i = store.data.tracks.findIndex((t) => t.path === file);
      if (i >= 0) { fresh.manual = store.data.tracks[i].manual; store.data.tracks[i] = fresh; }
      store.save();
      return { track: fresh, coverIgnored: !isMp3 && !!coverPath };
    } catch (err) {
      return { error: 'write', message: String(err.message || err).slice(0, 200) };
    }
  });

  ipcMain.handle('folders:save', (_e, folders) => {
    store.data.folders = folders;
    store.save();
    return true;
  });

  ipcMain.handle('settings:save', (_e, patch) => {
    if (patch.lang && patch.lang !== store.data.settings.lang) yt = null; // la búsqueda de YouTube sigue el idioma
    store.data.settings = { ...store.data.settings, ...patch };
    store.save();
    return true;
  });

  ipcMain.handle('preamp:get', () => store.data.settings.preamp);
  ipcMain.on('preamp:set', (_e, preamp) => {
    store.data.settings.preamp = preamp;
    store.save();
    sendStageAllFrames('preamp:update', preamp);
  });

  ipcMain.on('player:cmd', (_e, cmd) => sendStage('player:cmd', cmd));
  ipcMain.on('player:state', (_e, s) => sendControl('player:state', s));
  ipcMain.on('player:event', (_e, ev) => sendControl('player:event', ev));
  ipcMain.on('player:level', (_e, v) => sendControl('player:level', v));

  // Estado general que publica la ventana de control → celular, mini reproductor, bandeja
  ipcMain.on('app:state', (_e, s) => {
    appState = s;
    desktop?.update(s);
    remote?.push(s);
  });
  ipcMain.on('app:cmd', (_e, c) => sendControl('app:cmd', c)); // desde el mini reproductor

  ipcMain.handle('remote:set', (_e, on) => setRemote(!!on));
  ipcMain.handle('remote:info', () => (remote ? { url: remote.url, qr: remote.qr, clients: remote.clients() } : null));

  ipcMain.handle('mini:set', (_e, on) => desktop.toggleMini(!!on));
  ipcMain.on('mini:toggle', (_e, on) => desktop.toggleMini(!!on));
  ipcMain.on('mini:ready', () => desktop.miniReady());
  ipcMain.on('mini:expand', () => { desktop.toggleMini(false); showMain(); });

  ipcMain.on('stage:bounds', (_e, r) => {
    stageRect = r;
    applyStageBounds();
  });
  ipcMain.handle('dual:set', (_e, on) => setDual(!!on));
  ipcMain.on('stage:dblclick', () => {
    if (stageWin) stageWin.setFullScreen(!stageWin.isFullScreen());
    else setDual(true);
  });
  ipcMain.on('stage:key', (_e, key) => {
    if (key === 'Escape' && stageWin?.isFullScreen()) stageWin.setFullScreen(false);
    else sendControl('hotkey', key);
  });

  ipcMain.handle('shell:show', (_e, p) => { if (trackPaths.has(p)) shell.showItemInFolder(p); });

  // Menú del temporizador para dormir
  ipcMain.handle('menu:sleep', (_e, { active }) => new Promise((resolve) => {
    let done = false;
    const pick = (v) => { if (!done) { done = true; resolve(v); } };
    const tpl = [
      { label: tm('sleepTitle'), enabled: false },
      ...[15, 30, 45, 60, 90].map((n) => ({ label: tm('sleepMin', { n }), click: () => pick(n) })),
      { label: tm('sleepEnd'), click: () => pick('end') },
    ];
    if (active) tpl.push({ type: 'separator' }, { label: tm('sleepCancel'), click: () => pick('cancel') });
    Menu.buildFromTemplate(tpl).popup({ window: controlWin, callback: () => setTimeout(() => pick(null), 150) });
  }));

  // Menú contextual nativo de una pista (no lo tapa el video)
  ipcMain.handle('menu:track', (_e, { folders, inFolder, isLocal, count, isFav }) => new Promise((resolve) => {
    let done = false;
    const pick = (v) => { if (!done) { done = true; resolve(v); } };
    const folderMenu = (parentId) => folders
      .filter((f) => (f.parentId || null) === parentId)
      .map((f) => {
        const kids = folderMenu(f.id);
        const self = { label: kids.length ? tm('addToNamed', { name: f.name }) : f.name, click: () => pick({ action: 'addToFolder', folderId: f.id }) };
        return kids.length ? { label: f.name, submenu: [self, { type: 'separator' }, ...kids] } : self;
      });
    const many = count > 1 ? ` (${count})` : '';
    const tpl = [
      { label: tm('play'), click: () => pick({ action: 'play' }) },
      { label: tm('playNext') + many, click: () => pick({ action: 'playNext' }) },
      { label: tm('enqueue') + many, click: () => pick({ action: 'enqueue' }) },
      { type: 'separator' },
      { label: (isFav ? tm('favRemove') : tm('favAdd')) + many, click: () => pick({ action: 'favorite' }) },
      {
        label: tm('addTo') + many,
        submenu: [
          { label: tm('newFolder'), click: () => pick({ action: 'newFolder' }) },
          ...(folders.length ? [{ type: 'separator' }, ...folderMenu(null)] : []),
        ],
      },
    ];
    if (inFolder) tpl.push({ label: tm('removeFrom') + many, click: () => pick({ action: 'removeFromFolder' }) });
    if (count === 1) tpl.push({ type: 'separator' }, { label: tm('lyrics'), click: () => pick({ action: 'lyrics' }) });
    if (isLocal) tpl.push({ label: tm('editTags'), click: () => pick({ action: 'editTags' }) }, { label: tm('reveal'), click: () => pick({ action: 'reveal' }) });
    Menu.buildFromTemplate(tpl).popup({ window: controlWin, callback: () => setTimeout(() => pick(null), 150) });
  }));
}

async function addFiles(paths) {
  const known = new Set(store.data.tracks.map((t) => t.path));
  for (const p of paths) {
    if (known.has(p) || !mediaKind(p)) continue;
    const t = await readTrack(p);
    t.manual = true;
    store.data.tracks.push(t);
  }
  applyOverrides(store.data.tracks);
  refreshTrackPaths();
  store.save();
  return store.data.tracks;
}

let scanning = null;
function rescan() {
  if (scanning) return scanning;
  scanning = (async () => {
    const manual = store.data.tracks.filter((t) => t.manual);
    const scanned = await scanFolders(store.data.sources, store.data.tracks, (done, total) =>
      sendControl('lib:progress', { done, total }));
    const seen = new Set(scanned.map((t) => t.path));
    store.data.tracks = applyOverrides([...scanned, ...manual.filter((t) => !seen.has(t.path))]);
    refreshTrackPaths();
    store.save();
    sendControl('lib:progress', null);
    return store.data.tracks;
  })().finally(() => { scanning = null; });
  return scanning;
}

// ---------- Arranque ----------
if (process.env.MP_USER_DATA) app.setPath('userData', process.env.MP_USER_DATA); // perfil aparte para pruebas
if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === 'win32') app.setAppUserModelId('com.edros.musicplayer'); // icono propio en la barra de tareas
app.on('second-instance', showMain);

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  refreshTrackPaths();
  srv = await startServer({ rendererDir: RENDERER, isAllowedMedia: (p) => trackPaths.has(p) });
  installAdBlock(session.defaultSession);
  Menu.setApplicationMenu(null);
  setupIpc();
  createControlWindow();

  desktop = createDesktop({
    icon: ICON,
    preloadDir: PRELOAD,
    origin: srv.origin,
    token: srv.token,
    getWin: () => controlWin,
    sendCmd: (c) => sendControl('app:cmd', c),
    tm,
    settings: () => store.data.settings,
    showMain,
    quit: () => controlWin?.close(),
  });
  desktop.initTray();
  if (store.data.settings.remote) setRemote(true).catch(() => {});

  const keys = { MediaPlayPause: 'MediaPlayPause', MediaNextTrack: 'MediaNextTrack', MediaPreviousTrack: 'MediaPreviousTrack', MediaStop: 'MediaStop' };
  for (const k of Object.keys(keys)) {
    try { globalShortcut.register(k, () => sendControl('hotkey', keys[k])); } catch { /* tecla ocupada por otra app */ }
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  store?.flush();
});

app.on('window-all-closed', () => quitApp());
