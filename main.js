const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;

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
}

app.whenReady().then(createWindow);

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
