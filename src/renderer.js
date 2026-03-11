/* global require */
(function () {
  const BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';

  require.config({
    baseUrl: BASE,
    paths: { vs: BASE + '/vs' },
    'vs/nls': { availableLanguages: {} },
  });

  window.MonacoEnvironment = {
    getWorkerUrl: function (_workerId, label) {
      if (label === 'json') return BASE + '/vs/language/json/json.worker.js';
      if (label === 'css' || label === 'scss' || label === 'less') return BASE + '/vs/language/css/css.worker.js';
      if (label === 'html' || label === 'handlebars' || label === 'razor') return BASE + '/vs/language/html/html.worker.js';
      if (label === 'typescript' || label === 'javascript') return BASE + '/vs/language/typescript/ts.worker.js';
      return BASE + '/vs/editor/editor.worker.js';
    },
  };

  require(['vs/editor/editor.main'], function () {
    initApp();
  });

  function initApp() {
    const { openFolder, listDir, readFile, writeFile, terminal: terminalAPI } = window.alexide;
    let projectRoot = null;
    let editor = null;
    const openTabs = new Map();
    let activeFilePath = null;

    const monacoRoot = document.getElementById('monaco-root');
    const fileTreeEl = document.getElementById('file-tree');
    const folderPlaceholder = document.getElementById('folder-placeholder');
    const tabsEl = document.getElementById('tabs');
    const statusItem = document.getElementById('status-item');
    const statusPosition = document.getElementById('status-position');
    const ideEl = document.querySelector('.ide');
    const terminalPanel = document.getElementById('terminal-panel');
    const panelResizer = document.getElementById('panel-resizer');
    const panelToggle = document.getElementById('panel-toggle');
    const statusTerminalBtn = document.getElementById('status-terminal-btn');
    const terminalContainer = document.getElementById('terminal-container');

    let xtermTerminal = null;
    let xtermFitAddon = null;
    const PANEL_HEIGHT_KEY = 'alexide-panel-height';
    const PANEL_COLLAPSED_KEY = 'alexide-panel-collapsed';
    const DEFAULT_PANEL_HEIGHT = 240;
    const MIN_PANEL_HEIGHT = 80;
    const MAX_PANEL_HEIGHT_PERCENT = 0.6;
    const PANEL_BAR_HEIGHT = 28;

    function getExtension(path) {
      const i = path.lastIndexOf('.');
      return i > 0 ? path.slice(i + 1).toLowerCase() : '';
    }

    function getLanguage(path) {
      const ext = getExtension(path);
      const map = {
        js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
        json: 'json', html: 'html', css: 'css', scss: 'scss', less: 'less',
        md: 'markdown', py: 'python', sh: 'shell', yaml: 'yaml', yml: 'yaml',
      };
      return map[ext] || 'plaintext';
    }

    function createEditor() {
      if (editor) return editor;
      editor = window.monaco.editor.create(monacoRoot, {
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: 'SF Mono, Monaco, Cascadia Code, Source Code Pro, Menlo, Consolas, monospace',
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
      });
      editor.onDidChangeCursorPosition(function (e) {
        const pos = e.position;
        statusPosition.textContent = 'Ln ' + pos.lineNumber + ', Col ' + pos.column;
      });
      editor.onDidChangeModelContent(function () {
        const path = activeFilePath;
        if (path && openTabs.has(path)) {
          openTabs.get(path).dirty = true;
          updateTabLabel(path);
        }
      });
      return editor;
    }

    function updateTabLabel(filePath) {
      const tab = openTabs.get(filePath);
      if (!tab || !tab.el) return;
      const name = tab.name + (tab.dirty ? ' •' : '');
      const label = tab.el.querySelector('.label');
      if (label) label.textContent = name;
    }

    function addTab(filePath, content, name) {
      name = name || filePath.split(/[/\\]/).pop();
      if (openTabs.has(filePath)) {
        switchToTab(filePath);
        return;
      }
      const language = getLanguage(filePath);
      const model = window.monaco.editor.createModel(content || '', language, window.monaco.Uri.file(filePath));
      const tab = {
        filePath,
        name,
        model,
        dirty: false,
        el: null,
      };
      openTabs.set(filePath, tab);

      const tabEl = document.createElement('div');
      tabEl.className = 'tab';
      tabEl.dataset.path = filePath;
      tabEl.innerHTML = '<span class="label">' + escapeHtml(name) + '</span><button type="button" class="close" aria-label="Close">×</button>';
      tab.el = tabEl;
      tabsEl.appendChild(tabEl);

      tabEl.querySelector('.close').addEventListener('click', function (e) {
        e.stopPropagation();
        closeTab(filePath);
      });
      tabEl.addEventListener('click', function () {
        switchToTab(filePath);
      });

      switchToTab(filePath);
    }

    function escapeHtml(s) {
      const div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    }

    function switchToTab(filePath) {
      const tab = openTabs.get(filePath);
      if (!tab) return;
      createEditor();
      editor.setModel(tab.model);
      activeFilePath = filePath;
      document.querySelectorAll('.tab').forEach(function (el) {
        el.classList.toggle('open', el.dataset.path === filePath);
      });
      const pos = editor.getPosition();
      if (pos) statusPosition.textContent = 'Ln ' + pos.lineNumber + ', Col ' + pos.column;
    }

    function closeTab(filePath) {
      const tab = openTabs.get(filePath);
      if (!tab) return;
      tab.model.dispose();
      if (tab.el && tab.el.parentNode) tab.el.parentNode.removeChild(tab.el);
      openTabs.delete(filePath);
      if (activeFilePath === filePath) {
        const next = openTabs.keys().next().value;
        if (next) switchToTab(next);
        else {
          activeFilePath = null;
          editor.setModel(window.monaco.editor.createModel('', 'plaintext'));
        }
      }
    }

    function openFile(filePath, name) {
      statusItem.textContent = 'Loading…';
      readFile(filePath).then(function (res) {
        statusItem.textContent = 'Ready';
        if (res.ok) addTab(filePath, res.content, name);
        else statusItem.textContent = 'Error: ' + res.error;
      });
    }

    function saveCurrent() {
      if (!activeFilePath || !editor) return;
      const tab = openTabs.get(activeFilePath);
      if (!tab || !tab.dirty) return;
      const content = editor.getValue();
      writeFile(activeFilePath, content).then(function (res) {
        if (res.ok) {
          tab.dirty = false;
          updateTabLabel(activeFilePath);
          statusItem.textContent = 'Saved';
        } else statusItem.textContent = 'Save error: ' + res.error;
      });
    }

    function renderTree(entries, parentPath, container) {
      entries.forEach(function (entry) {
        const div = document.createElement('div');
        div.className = 'tree-item';
        div.dataset.path = entry.path;
        div.dataset.isDir = entry.isDirectory;
        const icon = entry.isDirectory ? '📁' : '📄';
        div.innerHTML = '<span class="icon">' + icon + '</span><span class="name">' + escapeHtml(entry.name) + '</span>';
        container.appendChild(div);

        if (entry.isDirectory) {
          div.addEventListener('click', function (e) {
            e.stopPropagation();
            div.classList.toggle('open');
            const children = div.querySelector('.tree-children');
            if (children) {
              children.style.display = children.style.display === 'none' ? 'block' : 'none';
              return;
            }
            const childContainer = document.createElement('div');
            childContainer.className = 'tree-children';
            div.appendChild(childContainer);
            listDir(entry.path).then(function (r) {
              if (r.ok) renderTree(r.entries, entry.path, childContainer);
            });
          });
        } else {
          div.addEventListener('click', function () {
            openFile(entry.path, entry.name);
          });
        }
      });
    }

    function openFolderClicked() {
      openFolder().then(function (folderPath) {
        if (!folderPath) return;
        projectRoot = folderPath;
        folderPlaceholder.style.display = 'none';
        fileTreeEl.style.display = 'block';
        fileTreeEl.innerHTML = '';
        statusItem.textContent = 'Loading…';
        listDir(folderPath).then(function (r) {
          statusItem.textContent = 'Ready';
          if (r.ok) renderTree(r.entries, folderPath, fileTreeEl);
          else statusItem.textContent = 'Error: ' + r.error;
        });
      });
    }

    document.getElementById('open-folder-sidebar').addEventListener('click', openFolderClicked);
    if (window.alexide.onMenuOpenFolder) window.alexide.onMenuOpenFolder(openFolderClicked);

    document.addEventListener('keydown', function (e) {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveCurrent();
      }
    });

    function getStoredPanelHeight() {
      const v = localStorage.getItem(PANEL_HEIGHT_KEY);
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= MIN_PANEL_HEIGHT ? n : DEFAULT_PANEL_HEIGHT;
    }

    function setPanelHeight(h) {
      const max = window.innerHeight * MAX_PANEL_HEIGHT_PERCENT;
      const height = Math.max(MIN_PANEL_HEIGHT, Math.min(max, h));
      terminalPanel.style.height = height + 'px';
      localStorage.setItem(PANEL_HEIGHT_KEY, String(height));
      if (xtermFitAddon && xtermTerminal) xtermFitAddon.fit();
    }

    function setPanelCollapsed(collapsed) {
      terminalPanel.classList.toggle('collapsed', collapsed);
      ideEl.classList.toggle('panel-collapsed', collapsed);
      terminalPanel.style.height = collapsed ? (PANEL_BAR_HEIGHT + 'px') : (getStoredPanelHeight() + 'px');
      localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? '1' : '0');
      panelToggle.textContent = collapsed ? '+' : '−';
      panelToggle.setAttribute('aria-label', collapsed ? 'Show terminal panel' : 'Minimize terminal panel');
      if (!collapsed && xtermFitAddon && xtermTerminal) {
        setTimeout(function () { xtermFitAddon.fit(); }, 0);
      }
    }

    function togglePanel() {
      const collapsed = terminalPanel.classList.contains('collapsed');
      setPanelCollapsed(!collapsed);
      if (!collapsed) initTerminal();
    }

    function initTerminal() {
      if (xtermTerminal) return;
      const Terminal = window.Terminal;
      const FitAddonCtor = window.FitAddon?.FitAddon || window.FitAddon;
      if (!Terminal || !FitAddonCtor) return;
      xtermTerminal = new Terminal({
        theme: { background: '#1e1e1e', foreground: '#cccccc' },
        fontFamily: 'SF Mono, Monaco, Cascadia Code, Source Code Pro, Menlo, Consolas, monospace',
        fontSize: 13,
        cursorBlink: true,
      });
      xtermFitAddon = new FitAddonCtor();
      xtermTerminal.loadAddon(xtermFitAddon);
      xtermTerminal.open(terminalContainer);
      xtermFitAddon.fit();

      terminalAPI.onData(function (data) {
        if (xtermTerminal) xtermTerminal.write(data);
      });
      xtermTerminal.onData(function (data) {
        terminalAPI.sendInput(data);
      });

      terminalAPI.create(projectRoot || undefined).then(function (res) {
        if (!res.ok) {
          xtermTerminal.writeln('Terminal error: ' + (res.error || 'Unknown'));
          return;
        }
        xtermFitAddon.fit();
        terminalAPI.resize(xtermTerminal.cols, xtermTerminal.rows);
      });
    }

    const collapsedStored = localStorage.getItem(PANEL_COLLAPSED_KEY) === '1';
    const initialHeight = getStoredPanelHeight();
    terminalPanel.style.height = initialHeight + 'px';
    setPanelCollapsed(collapsedStored);
    if (!collapsedStored) initTerminal();

    panelToggle.addEventListener('click', togglePanel);
    statusTerminalBtn.addEventListener('click', togglePanel);

    panelResizer.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = terminalPanel.offsetHeight;

      function onMouseMove(ev) {
        const delta = startY - ev.clientY;
        setPanelHeight(startHeight + delta);
      }
      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    window.addEventListener('resize', function () {
      if (xtermFitAddon && xtermTerminal && !terminalPanel.classList.contains('collapsed')) {
        xtermFitAddon.fit();
        terminalAPI.resize(xtermTerminal.cols, xtermTerminal.rows);
      }
    });
  }
})();
