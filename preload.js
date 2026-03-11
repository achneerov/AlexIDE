const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alexide', {
  platform: process.platform,
  openFolder: () => ipcRenderer.invoke('open-folder'),
  listDir: (dirPath) => ipcRenderer.invoke('list-dir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
});
