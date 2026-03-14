const { contextBridge, ipcRenderer } = require('electron');

let onMenuOpenFolder = null;
let onMenuToggleTerminal = null;
ipcRenderer.on('menu-open-folder', () => {
  if (typeof onMenuOpenFolder === 'function') onMenuOpenFolder();
});
ipcRenderer.on('menu-toggle-terminal', () => {
  if (typeof onMenuToggleTerminal === 'function') onMenuToggleTerminal();
});

contextBridge.exposeInMainWorld('alexide', {
  platform: process.platform,
  getIconDataUrl: () => ipcRenderer.invoke('get-icon-data-url'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  onMenuOpenFolder: (fn) => { onMenuOpenFolder = fn; },
  onMenuToggleTerminal: (fn) => { onMenuToggleTerminal = fn; },
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  openInBrowser: (filePath) => ipcRenderer.invoke('open-in-browser', filePath),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
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
    kill: (terminalId) => ipcRenderer.invoke('terminal-kill', terminalId),
    killAll: () => ipcRenderer.invoke('terminal-kill-all'),
    onData: (fn) => {
      ipcRenderer.on('terminal-data', (_event, terminalId, data) => fn(terminalId, data));
    },
    sendInput: (terminalId, data) => ipcRenderer.send('terminal-input', terminalId, data),
    resize: (terminalId, cols, rows) => ipcRenderer.send('terminal-resize', terminalId, cols, rows),
  },
  git: {
    status: (cwd) => ipcRenderer.invoke('git-status', cwd),
    branches: (cwd) => ipcRenderer.invoke('git-branches', cwd),
    checkout: (cwd, branch) => ipcRenderer.invoke('git-checkout', cwd, branch),
    showIndex: (cwd, filePath) => ipcRenderer.invoke('git-show-index', cwd, filePath),
    showHead: (cwd, filePath) => ipcRenderer.invoke('git-show-head', cwd, filePath),
    add: (cwd, filePath) => ipcRenderer.invoke('git-add', cwd, filePath),
    addAll: (cwd) => ipcRenderer.invoke('git-add-all', cwd),
    reset: (cwd, filePath) => ipcRenderer.invoke('git-reset', cwd, filePath),
    resetAll: (cwd) => ipcRenderer.invoke('git-reset-all', cwd),
    restore: (cwd, filePath) => ipcRenderer.invoke('git-restore', cwd, filePath),
    commit: (cwd, message) => ipcRenderer.invoke('git-commit', cwd, message),
    push: (cwd) => ipcRenderer.invoke('git-push', cwd),
  },
  diff: {
    compute: (oldText, newText) => ipcRenderer.invoke('compute-diff', oldText, newText),
  },
});
