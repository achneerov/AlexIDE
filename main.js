const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, shell, clipboard } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs').promises;
const pty = require('node-pty');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const diff = require('diff');

const iconPath = path.join(__dirname, 'assets', 'icon.png');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'AlexIDE',
    show: false,
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.webContents.on('context-menu', async (event, params) => {
    event.preventDefault();
    const x = params.x;
    const y = params.y;
    let context = null;
    try {
      context = await win.webContents.executeJavaScript('window.__lastExplorerContextMenuContext || null');
    } catch (_) {}
    let template;
    if (context && context.projectRoot) {
      const { targetPath, parentDir, hasItem } = context;
      const revealLabel = process.platform === 'darwin' ? 'Reveal in Finder' : (process.platform === 'win32' ? 'Show in Explorer' : 'Reveal in File Manager');
      template = [
        { label: 'New File', click: () => win.webContents.send('explorer-context-action', { action: 'new-file', parentDir: parentDir || targetPath }) },
        { label: 'New Folder', click: () => win.webContents.send('explorer-context-action', { action: 'new-folder', parentDir: parentDir || targetPath }) },
        { type: 'separator' },
      ];
      if (hasItem) {
        template.push(
          { label: revealLabel, click: () => { try { shell.showItemInFolder(path.resolve(targetPath)); } catch (_) {} } },
          { label: 'Open in Default App', click: () => { try { shell.openExternal(pathToFileURL(path.resolve(targetPath)).href); } catch (_) {} } },
          { label: 'Copy Absolute Path', click: () => { clipboard.writeText(targetPath); } },
          { type: 'separator' },
          { label: 'Rename', click: () => win.webContents.send('explorer-context-action', { action: 'rename', targetPath }) },
          { label: 'Delete', click: () => win.webContents.send('explorer-context-action', { action: 'delete', targetPath }) }
        );
      }
    } else {
      template = [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { type: 'separator' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: process.platform === 'darwin' ? 'Inspect Element' : 'Inspect', click: () => win.webContents.inspectElement(x, y) },
      ];
    }
    const menu = Menu.buildFromTemplate(template);
    const popupOpts = { window: win, x, y };
    if (process.platform === 'darwin') popupOpts.positioningItem = 0;
    menu.popup(popupOpts);
  });

  win.on('closed', () => {
    const winMap = terminalPtyMap.get(win.id);
    if (winMap) {
      winMap.forEach((ptyProcess) => { try { ptyProcess.kill(); } catch (_) {} });
      terminalPtyMap.delete(win.id);
    }
  });
}

// winId -> Map<terminalId, { pty }>
const terminalPtyMap = new Map();
let terminalIdCounter = 0;

function getShellName(shellPath) {
  if (!shellPath) return 'sh';
  const name = path.basename(shellPath).toLowerCase();
  if (name === 'cmd.exe') return 'cmd';
  return name.replace(/\.(exe|sh)$/, '') || 'sh';
}

ipcMain.handle('terminal-create', async (event, cwd) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'No window' };
  const winId = win.id;
  let winMap = terminalPtyMap.get(winId);
  if (!winMap) {
    winMap = new Map();
    terminalPtyMap.set(winId, winMap);
  }
  const terminalId = String(++terminalIdCounter);
  const shell = process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : (process.env.SHELL || '/bin/sh');
  const shellName = getShellName(shell);
  const startCwd = (cwd && String(cwd).trim()) ? path.resolve(cwd) : process.cwd();
  try {
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cwd: startCwd,
      env: process.env,
    });
    winMap.set(terminalId, ptyProcess);
    ptyProcess.onData((data) => {
      if (win && !win.isDestroyed()) win.webContents.send('terminal-data', terminalId, data);
    });
    ptyProcess.onExit(() => {
      if (winMap.get(terminalId) === ptyProcess) winMap.delete(terminalId);
    });
    return { ok: true, terminalId, shellName };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('terminal-kill', (event, terminalId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !terminalId) return;
  const winMap = terminalPtyMap.get(win.id);
  if (!winMap) return;
  const ptyProcess = winMap.get(terminalId);
  if (ptyProcess) {
    try { ptyProcess.kill(); } catch (_) {}
    winMap.delete(terminalId);
  }
  return undefined;
});

ipcMain.handle('terminal-kill-all', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const winMap = terminalPtyMap.get(win.id);
  if (winMap) {
    winMap.forEach((ptyProcess) => { try { ptyProcess.kill(); } catch (_) {} });
    winMap.clear();
  }
  return undefined;
});

ipcMain.on('terminal-input', (event, terminalId, data) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !terminalId) return;
  const winMap = terminalPtyMap.get(win.id);
  if (!winMap) return;
  const ptyProcess = winMap.get(terminalId);
  if (ptyProcess) ptyProcess.write(data);
});

ipcMain.on('terminal-resize', (event, terminalId, cols, rows) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !terminalId) return;
  const winMap = terminalPtyMap.get(win.id);
  if (!winMap) return;
  const ptyProcess = winMap.get(terminalId);
  if (ptyProcess) ptyProcess.resize(cols, rows);
});

function buildAppMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow(),
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && !win.isDestroyed()) win.webContents.send('menu-open-folder');
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && !win.isDestroyed()) {
              const level = win.webContents.getZoomLevel();
              win.webContents.setZoomLevel(level + 0.5);
            }
          },
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && !win.isDestroyed()) {
              const level = win.webContents.getZoomLevel();
              win.webContents.setZoomLevel(level - 0.5);
            }
          },
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && !win.isDestroyed()) win.webContents.setZoomLevel(0);
          },
        },
        { type: 'separator' },
        {
          label: 'Toggle Terminal',
          accelerator: 'CmdOrCtrl+J',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && !win.isDestroyed()) win.webContents.send('menu-toggle-terminal');
          },
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && !win.isDestroyed()) win.webContents.toggleDevTools();
          },
        },
      ],
    },
    { role: 'windowMenu' },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  if (app.dock) app.dock.setIcon(nativeImage.createFromPath(iconPath));
  buildAppMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// File system APIs for project explorer
ipcMain.handle('open-folder', async () => {
  console.log('[AlexIDE] open-folder: renderer requested dialog');
  const result = await dialog.showOpenDialog(null, {
    properties: ['openDirectory'],
    title: 'Open Folder',
  });
  console.log('[AlexIDE] open-folder: dialog closed', {
    canceled: result.canceled,
    filePaths: result.filePaths,
  });
  const out = result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  console.log('[AlexIDE] open-folder: returning', out);
  return out;
});

ipcMain.handle('list-dir', async (_event, dirPath) => {
  console.log('[AlexIDE] list-dir:', dirPath);
  try {
    const names = await fs.readdir(dirPath, { withFileTypes: true });
    const entries = names
      .map((d) => ({
        name: d.name,
        path: path.join(dirPath, d.name),
        isDirectory: d.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    console.log('[AlexIDE] list-dir: ok, entries=', entries.length);
    return { ok: true, entries };
  } catch (err) {
    console.log('[AlexIDE] list-dir: error', err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-icon-data-url', async () => {
  try {
    const buf = await fs.readFile(iconPath);
    const base64 = buf.toString('base64');
    return { ok: true, dataUrl: 'data:image/png;base64,' + base64 };
  } catch (err) {
    return { ok: false };
  }
});

ipcMain.handle('show-item-in-folder', (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') return;
  try {
    shell.showItemInFolder(path.resolve(filePath));
  } catch (err) {}
});

ipcMain.handle('open-in-browser', (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') return;
  try {
    const url = pathToFileURL(path.resolve(filePath)).href;
    shell.openExternal(url);
  } catch (err) {}
});

ipcMain.handle('copy-to-clipboard', (_event, text) => {
  if (text != null) clipboard.writeText(String(text));
});

ipcMain.handle('show-unsaved-close-dialog', (event, fileName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { response: 2 };
  const result = dialog.showMessageBoxSync(win, {
    type: 'warning',
    message: 'Do you want to save the changes you made to the document "' + (fileName || 'Untitled') + '"?',
    detail: 'Your changes will be lost if you don\'t save them.',
    buttons: process.platform === 'darwin' ? ['Save', "Don't Save", 'Cancel'] : ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });
  return { response: result.response };
});

ipcMain.handle('read-file', async (_event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('write-file', async (_event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Git API (run from cwd = project root)
// Do NOT trim stdout before split: the first column is " " for "not staged", and trim() would remove it.
function parsePorcelain(stdout) {
  const staged = [];
  const unstaged = [];
  const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
  for (const line of lines) {
    if (line.length < 4) continue; // need at least "XY path"
    const stagedChar = line[0];
    const unstagedChar = line[1];
    const rest = line.slice(3).trim(); // path (may have leading space when e.g. "M  path")
    const filePath = rest.includes(' -> ') ? rest.split(' -> ').pop().trim() : rest;
    // X = index (staged), Y = work tree (unstaged)
    if (stagedChar !== ' ' && stagedChar !== '?' && stagedChar !== '!') {
      staged.push({ path: filePath, status: stagedChar });
    }
    if (unstagedChar !== ' ' && unstagedChar !== '!' && unstagedChar !== '.') {
      unstaged.push({ path: filePath, status: unstagedChar });
    }
  }
  return { staged, unstaged };
}

ipcMain.handle('git-status', async (_event, cwd) => {
  if (!cwd) return { ok: false, error: 'No folder', isRepo: false };
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd, maxBuffer: 4096 });
  } catch {
    return { ok: true, isRepo: false, staged: [], unstaged: [], aheadCount: 0 };
  }
  try {
    const { stdout } = await execAsync('git status --porcelain -uall', { cwd, maxBuffer: 1024 * 1024 });
    const { staged, unstaged } = parsePorcelain(stdout);
    let aheadCount = 0;
    try {
      const { stdout: countOut } = await execAsync('git rev-list --count @{u}..HEAD', { cwd, maxBuffer: 4096 });
      const n = parseInt(countOut.trim(), 10);
      if (Number.isFinite(n) && n > 0) aheadCount = n;
    } catch (_) {}
    return { ok: true, isRepo: true, staged, unstaged, aheadCount };
  } catch (err) {
    return { ok: false, error: err.message, isRepo: true, staged: [], unstaged: [], aheadCount: 0 };
  }
});

ipcMain.handle('git-add', async (_event, cwd, filePath) => {
  if (!cwd || !filePath) return { ok: false, error: 'Missing cwd or path' };
  try {
    const escaped = filePath.replace(/\\/g, '/').includes(' ') ? `"${filePath.replace(/"/g, '\\"')}"` : filePath;
    await execAsync('git add -- ' + escaped, { cwd, maxBuffer: 4096 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('git-reset', async (_event, cwd, filePath) => {
  if (!cwd || !filePath) return { ok: false, error: 'Missing cwd or path' };
  try {
    const escaped = filePath.replace(/\\/g, '/').includes(' ') ? `"${filePath.replace(/"/g, '\\"')}"` : filePath;
    await execAsync('git reset HEAD -- ' + escaped, { cwd, maxBuffer: 4096 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('git-add-all', async (_event, cwd) => {
  if (!cwd) return { ok: false, error: 'No folder' };
  try {
    await execAsync('git add -A', { cwd, maxBuffer: 4096 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('git-reset-all', async (_event, cwd) => {
  if (!cwd) return { ok: false, error: 'No folder' };
  try {
    await execAsync('git reset HEAD', { cwd, maxBuffer: 4096 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('git-commit', async (_event, cwd, message) => {
  if (!cwd) return { ok: false, error: 'No folder' };
  if (!message || !message.trim()) return { ok: false, error: 'Commit message is required' };
  try {
    const msg = message.trim().replace(/"/g, '\\"').replace(/\$/g, '\\$');
    await execAsync('git commit -m "' + msg + '"', { cwd, maxBuffer: 4096 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('git-push', async (_event, cwd) => {
  if (!cwd) return { ok: false, error: 'No folder' };
  try {
    await execAsync('git push', { cwd, maxBuffer: 1024 * 1024 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('git-restore', async (_event, cwd, filePath) => {
  if (!cwd || !filePath) return { ok: false, error: 'Missing cwd or path' };
  try {
    const escaped = filePath.replace(/\\/g, '/').includes(' ') ? `"${filePath.replace(/"/g, '\\"')}"` : filePath;
    await execAsync('git checkout -- ' + escaped, { cwd, maxBuffer: 4096 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('git-branches', async (_event, cwd) => {
  if (!cwd) return { ok: false, error: 'No folder', branches: [], current: null };
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd, maxBuffer: 4096 });
  } catch {
    return { ok: true, isRepo: false, branches: [], current: null };
  }
  try {
    const { stdout: branchOut } = await execAsync('git branch --no-color', { cwd, maxBuffer: 65536 });
    const branches = branchOut.split(/\r?\n/).map((line) => line.replace(/^\*?\s*/, '').trim()).filter(Boolean);
    let current = null;
    try {
      const { stdout: headOut } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd, maxBuffer: 4096 });
      current = headOut.trim() || null;
    } catch (_) {}
    return { ok: true, isRepo: true, branches, current };
  } catch (err) {
    return { ok: false, error: err.message, branches: [], current: null };
  }
});

ipcMain.handle('git-checkout', async (_event, cwd, branch) => {
  if (!cwd || !branch || !branch.trim()) return { ok: false, error: 'Missing cwd or branch' };
  try {
    const b = branch.trim().replace(/"/g, '\\"').replace(/\$/g, '\\$');
    await execAsync('git checkout "' + b + '"', { cwd, maxBuffer: 4096 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('git-show-index', async (_event, cwd, filePath) => {
  if (!cwd || !filePath) return { ok: false, error: 'Missing cwd or path', content: null };
  const escaped = filePath.replace(/\\/g, '/').replace(/"/g, '\\"').replace(/\$/g, '\\$');
  try {
    const { stdout } = await execAsync('git show ":' + escaped + '"', { cwd, maxBuffer: 1024 * 1024 });
    return { ok: true, content: stdout };
  } catch (_) {
    return { ok: true, content: '' };
  }
});

ipcMain.handle('git-show-head', async (_event, cwd, filePath) => {
  if (!cwd || !filePath) return { ok: false, error: 'Missing cwd or path', content: null };
  const escaped = filePath.replace(/\\/g, '/').replace(/"/g, '\\"').replace(/\$/g, '\\$');
  try {
    const { stdout } = await execAsync('git show "HEAD:' + escaped + '"', { cwd, maxBuffer: 1024 * 1024 });
    return { ok: true, content: stdout };
  } catch (_) {
    return { ok: true, content: '' };
  }
});

ipcMain.handle('compute-diff', (_event, oldText, newText) => {
  const chunks = diff.diffLines(oldText || '', newText || '');
  return chunks.map((c) => ({
    added: Boolean(c.added),
    removed: Boolean(c.removed),
    value: c.value == null ? '' : String(c.value),
  }));
});

ipcMain.handle('delete-file', async (_event, cwd, filePath) => {
  if (!cwd || !filePath) return { ok: false, error: 'Missing cwd or path' };
  try {
    const fullPath = path.join(cwd, filePath.replace(/\//g, path.sep));
    await fs.unlink(fullPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('create-file', async (_event, parentDir, name) => {
  if (!parentDir || !name || !name.trim()) return { ok: false, error: 'Missing parent or name' };
  try {
    const fullPath = path.join(parentDir, name.trim().replace(/\//g, path.sep));
    await fs.writeFile(fullPath, '', 'utf-8');
    return { ok: true, path: fullPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('create-folder', async (_event, parentDir, name) => {
  if (!parentDir || !name || !name.trim()) return { ok: false, error: 'Missing parent or name' };
  try {
    const fullPath = path.join(parentDir, name.trim().replace(/\//g, path.sep));
    await fs.mkdir(fullPath, { recursive: false });
    return { ok: true, path: fullPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('rename-path', async (_event, oldPath, newPath) => {
  if (!oldPath || !newPath) return { ok: false, error: 'Missing path' };
  try {
    await fs.rename(oldPath, newPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('delete-path', async (_event, targetPath) => {
  if (!targetPath) return { ok: false, error: 'Missing path' };
  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      await fs.rm(targetPath, { recursive: true, force: true });
    } else {
      await fs.unlink(targetPath);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
