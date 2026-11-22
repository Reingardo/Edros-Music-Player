// Integración con Windows: icono en la bandeja, botones en la miniatura de la barra de tareas,
// avisos de "Ahora suena" y el mini reproductor flotante.
import { Tray, Menu, nativeImage, Notification, BrowserWindow, screen, net } from 'electron';
import path from 'node:path';
import { readCover } from './library.js';

// Iconos blancos dibujados en memoria (sin archivos), coordenadas en una rejilla de 24×24
const SHAPES = {
  play: [[[7, 4.5], [20, 12], [7, 19.5]]],
  pause: [[[6, 4], [10, 4], [10, 20], [6, 20]], [[14, 4], [18, 4], [18, 20], [14, 20]]],
  next: [[[5, 4.5], [16, 12], [5, 19.5]], [[17, 5], [19.5, 5], [19.5, 19], [17, 19]]],
  prev: [[[19, 4.5], [8, 12], [19, 19.5]], [[4.5, 5], [7, 5], [7, 19], [4.5, 19]]],
};
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function raster(name, size = 32) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = ((x + (sx + 0.5) / SS) * 24) / size;
        const py = ((y + (sy + 0.5) / SS) * 24) / size;
        if (SHAPES[name].some((p) => inside(p, px, py))) hit++;
      }
      const a = Math.round((hit / (SS * SS)) * 255);
      const i = (y * size + x) * 4;
      buf[i] = a; buf[i + 1] = a; buf[i + 2] = a; buf[i + 3] = a; // BGRA premultiplicado
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export function createDesktop({ icon, preloadDir, origin, token, getWin, sendCmd, tm, settings, showMain, quit }) {
  const ICONS = Object.fromEntries(Object.keys(SHAPES).map((k) => [k, raster(k)]));
  let tray = null;
  let mini = null;
  let last = null;
  let lastId = null;
  let lastPaused = null;

  function trayMenu() {
    const s = last;
    return Menu.buildFromTemplate([
      ...(s?.current ? [{ label: `${s.current.title}`.slice(0, 60), enabled: false }, { type: 'separator' }] : []),
      { label: s && !s.paused ? tm('pause') : tm('play'), click: () => sendCmd({ action: 'toggle' }) },
      { label: tm('next'), click: () => sendCmd({ action: 'next' }) },
      { label: tm('prev'), click: () => sendCmd({ action: 'prev' }) },
      { type: 'separator' },
      { label: tm('mini'), type: 'checkbox', checked: !!mini, click: () => toggleMini(!mini) },
      { label: tm('show'), click: showMain },
      { type: 'separator' },
      { label: tm('quit'), click: quit },
    ]);
  }

  function initTray() {
    if (tray) return;
    tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }));
    tray.setToolTip('MusicPlayer');
    tray.on('click', showMain);
    tray.setContextMenu(trayMenu());
  }

  function updateThumbar(paused) {
    const win = getWin();
    if (!win || win.isDestroyed() || process.platform !== 'win32') return;
    win.setThumbarButtons([
      { tooltip: tm('prev'), icon: ICONS.prev, click: () => sendCmd({ action: 'prev' }) },
      { tooltip: paused ? tm('play') : tm('pause'), icon: paused ? ICONS.play : ICONS.pause, click: () => sendCmd({ action: 'toggle' }) },
      { tooltip: tm('next'), icon: ICONS.next, click: () => sendCmd({ action: 'next' }) },
    ]);
  }

  async function notify(cur) {
    if (settings().notifications === false || !Notification.isSupported()) return;
    const win = getWin();
    if (win && win.isFocused()) return; // si estás mirando la app no hace falta
    let img;
    try {
      if (cur.type === 'local' && cur.hasCover) {
        const c = await readCover(cur.id.slice(2)); // id local = "l:" + ruta
        if (c) img = nativeImage.createFromBuffer(c.data);
      } else if (cur.type === 'youtube') {
        const r = await net.fetch(`https://i.ytimg.com/vi/${cur.videoId}/mqdefault.jpg`);
        if (r.ok) img = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer()));
      }
    } catch { /* sin imagen */ }
    const n = new Notification({ title: cur.title, body: [cur.artist, tm('nowPlaying')].filter(Boolean).join(' · '), icon: img || icon, silent: true });
    n.on('click', showMain);
    n.show();
  }

  function update(state) {
    last = state;
    const cur = state.current;
    if (lastPaused !== state.paused) { updateThumbar(state.paused); lastPaused = state.paused; }
    if (tray) {
      tray.setToolTip(cur ? `${cur.title}${cur.artist ? ' — ' + cur.artist : ''}`.slice(0, 120) : 'MusicPlayer');
      tray.setContextMenu(trayMenu());
    }
    if (cur && cur.id !== lastId) { lastId = cur.id; notify(cur); }
    if (!cur) lastId = null;
    if (mini && !mini.isDestroyed()) mini.webContents.send('app:state', state);
  }

  function toggleMini(on) {
    if (on && !mini) {
      const wa = screen.getPrimaryDisplay().workArea;
      const W = 380, H = 96;
      mini = new BrowserWindow({
        width: W, height: H, x: wa.x + wa.width - W - 18, y: wa.y + wa.height - H - 18,
        frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
        alwaysOnTop: true, skipTaskbar: true, icon, title: 'MusicPlayer mini', show: false,
        webPreferences: { preload: path.join(preloadDir, 'mini.cjs'), contextIsolation: true, sandbox: true },
      });
      mini.setAlwaysOnTop(true, 'floating');
      mini.loadURL(`${origin}/app/mini.html?t=${token}`);
      mini.once('ready-to-show', () => mini.showInactive());
      mini.on('closed', () => { mini = null; sendCmd({ action: 'miniChanged', on: false }); if (tray) tray.setContextMenu(trayMenu()); });
    } else if (!on && mini) {
      mini.close();
    }
    if (tray) tray.setContextMenu(trayMenu());
    return !!mini || on;
  }

  return {
    initTray,
    update,
    toggleMini,
    miniReady: () => { if (mini && last) mini.webContents.send('app:state', last); },
    refreshThumbar: () => updateThumbar(lastPaused !== false),
    destroy: () => { tray?.destroy(); tray = null; if (mini && !mini.isDestroyed()) mini.destroy(); },
  };
}
