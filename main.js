const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const pty = require('node-pty');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
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

  win.on('closed', () => {
    const ptyProcess = terminalPtyMap.get(win.id);
    if (ptyProcess) {
      try { ptyProcess.kill(); } catch (_) {}
      terminalPtyMap.delete(win.id);
    }
  });
}

const terminalPtyMap = new Map();

ipcMain.handle('terminal-create', async (event, cwd) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'No window' };
  const winId = win.id;
  if (terminalPtyMap.has(winId)) {
    return { ok: true };
  }
  const shell = process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : (process.env.SHELL || '/bin/sh');
  const startCwd = cwd && path.isAbsolute(cwd) ? cwd : (cwd ? path.resolve(cwd) : process.cwd());
  try {
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cwd: startCwd,
      env: process.env,
    });
    terminalPtyMap.set(winId, ptyProcess);
    ptyProcess.onData((data) => {
      if (win && !win.isDestroyed()) win.webContents.send('terminal-data', data);
    });
    ptyProcess.onExit(() => {
      terminalPtyMap.delete(winId);
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on('terminal-input', (event, data) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const ptyProcess = terminalPtyMap.get(win.id);
  if (ptyProcess) ptyProcess.write(data);
});

ipcMain.on('terminal-resize', (event, cols, rows) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const ptyProcess = terminalPtyMap.get(win.id);
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
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
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
      .filter((d) => !d.name.startsWith('.'))
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
