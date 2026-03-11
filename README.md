# AlexIDE

A VS Code–like IDE built with **Electron**, **Monaco Editor**, and a simple file-based UI.

## Features

- **Sidebar** – Open a folder and browse files in a tree
- **Monaco Editor** – Syntax highlighting, minimap, multiple languages (JS, TS, JSON, HTML, CSS, Python, etc.)
- **Tabs** – Open multiple files; unsaved changes show a dot (•)
- **Save** – `Ctrl+S` / `Cmd+S` to save the current file
- **Status bar** – Line/column and status messages

## Run

```bash
npm install
npm start
```

Then use **Open Folder** (title bar or sidebar) to open a project directory and click files to edit them.

## Stack

- **Electron** – Desktop app shell and main process (file dialogs, read/write files)
- **Monaco Editor** – Same editor as VS Code (loaded from CDN)
- **Vanilla JS** – No framework; preload script exposes `window.alexide` for IPC

## Project layout

- `main.js` – Electron main process (window, IPC: open-folder, list-dir, read-file, write-file)
- `preload.js` – Exposes `alexide.openFolder`, `listDir`, `readFile`, `writeFile` to the renderer
- `src/index.html` – Shell (title bar, sidebar, tabs, editor area, status bar)
- `src/styles.css` – Dark theme layout
- `src/renderer.js` – Monaco init, file tree, tabs, open/save
