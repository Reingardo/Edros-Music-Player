const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('mp', {
  getLibrary: () => ipcRenderer.invoke('lib:get'),
  addSource: () => ipcRenderer.invoke('lib:addSource'),
  addFiles: () => ipcRenderer.invoke('lib:addFiles'),
  addPaths: (paths) => ipcRenderer.invoke('lib:addPaths', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  removeSource: (p) => ipcRenderer.invoke('lib:removeSource', p),
  rescan: () => ipcRenderer.invoke('lib:rescan'),
  saveData: (patch) => ipcRenderer.invoke('data:save', patch),
  ytSearch: (q) => ipcRenderer.invoke('yt:search', q),
  ytMore: () => ipcRenderer.invoke('yt:more'),
  ytVideo: (url) => ipcRenderer.invoke('yt:video', url),
  ytPlaylist: (url) => ipcRenderer.invoke('yt:playlist', url),
  ytRadio: (args) => ipcRenderer.invoke('yt:radio', args),
  lyrics: (item) => ipcRenderer.invoke('lyrics:get', item),
  pickCover: () => ipcRenderer.invoke('tags:pickCover'),
  saveTags: (t) => ipcRenderer.invoke('tags:save', t),
  saveFolders: (f) => ipcRenderer.invoke('folders:save', f),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  setPreamp: (p) => ipcRenderer.send('preamp:set', p),
  cmd: (c) => ipcRenderer.send('player:cmd', c),
  publish: (s) => ipcRenderer.send('app:state', s),
  stageBounds: (r) => ipcRenderer.send('stage:bounds', r),
  setDual: (on) => ipcRenderer.invoke('dual:set', on),
  setRemote: (on) => ipcRenderer.invoke('remote:set', on),
  remoteInfo: () => ipcRenderer.invoke('remote:info'),
  setMini: (on) => ipcRenderer.invoke('mini:set', on),
  trackMenu: (opts) => ipcRenderer.invoke('menu:track', opts),
  sleepMenu: (opts) => ipcRenderer.invoke('menu:sleep', opts),
  reveal: (p) => ipcRenderer.invoke('shell:show', p),
  onState: on('player:state'),
  onEvent: on('player:event'),
  onDual: on('dual:changed'),
  onHotkey: on('hotkey'),
  onProgress: on('lib:progress'),
  onTracks: on('lib:tracks'),
  onLevel: on('player:level'),
  onAppCmd: on('app:cmd'),
});
