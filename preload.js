const { contextBridge, ipcRenderer } = require('electron');

let onMenuOpenFolder = null;
ipcRenderer.on('menu-open-folder', () => {
  if (typeof onMenuOpenFolder === 'function') onMenuOpenFolder();
});

contextBridge.exposeInMainWorld('alexide', {
  platform: process.platform,
  openFolder: () => ipcRenderer.invoke('open-folder'),
  onMenuOpenFolder: (fn) => { onMenuOpenFolder = fn; },
  listDir: (dirPath) => ipcRenderer.invoke('list-dir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  terminal: {
    create: (cwd) => ipcRenderer.invoke('terminal-create', cwd || null),
    onData: (fn) => {
      ipcRenderer.on('terminal-data', (_event, data) => fn(data));
    },
    sendInput: (data) => ipcRenderer.send('terminal-input', data),
    resize: (cols, rows) => ipcRenderer.send('terminal-resize', cols, rows),
  },
});
