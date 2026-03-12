const { contextBridge, ipcRenderer } = require('electron');

let onMenuOpenFolder = null;
ipcRenderer.on('menu-open-folder', () => {
  if (typeof onMenuOpenFolder === 'function') onMenuOpenFolder();
});

contextBridge.exposeInMainWorld('alexide', {
  platform: process.platform,
  getIconDataUrl: () => ipcRenderer.invoke('get-icon-data-url'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  onMenuOpenFolder: (fn) => { onMenuOpenFolder = fn; },
  listDir: (dirPath) => ipcRenderer.invoke('list-dir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  deleteFile: (cwd, filePath) => ipcRenderer.invoke('delete-file', cwd, filePath),
  createFile: (parentDir, name) => ipcRenderer.invoke('create-file', parentDir, name),
  createFolder: (parentDir, name) => ipcRenderer.invoke('create-folder', parentDir, name),
  renamePath: (oldPath, newPath) => ipcRenderer.invoke('rename-path', oldPath, newPath),
  deletePath: (targetPath) => ipcRenderer.invoke('delete-path', targetPath),
  terminal: {
    create: (cwd) => ipcRenderer.invoke('terminal-create', cwd || null),
    onData: (fn) => {
      ipcRenderer.on('terminal-data', (_event, data) => fn(data));
    },
    sendInput: (data) => ipcRenderer.send('terminal-input', data),
    resize: (cols, rows) => ipcRenderer.send('terminal-resize', cols, rows),
  },
  git: {
    status: (cwd) => ipcRenderer.invoke('git-status', cwd),
    add: (cwd, filePath) => ipcRenderer.invoke('git-add', cwd, filePath),
    addAll: (cwd) => ipcRenderer.invoke('git-add-all', cwd),
    reset: (cwd, filePath) => ipcRenderer.invoke('git-reset', cwd, filePath),
    resetAll: (cwd) => ipcRenderer.invoke('git-reset-all', cwd),
    restore: (cwd, filePath) => ipcRenderer.invoke('git-restore', cwd, filePath),
    commit: (cwd, message) => ipcRenderer.invoke('git-commit', cwd, message),
    push: (cwd) => ipcRenderer.invoke('git-push', cwd),
  },
});
