const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mini', {
  onState: (cb) => ipcRenderer.on('app:state', (_e, s) => cb(s)),
  cmd: (c) => ipcRenderer.send('app:cmd', c),
  close: () => ipcRenderer.send('mini:toggle', false),
  expand: () => ipcRenderer.send('mini:expand'),
});
ipcRenderer.send('mini:ready');
