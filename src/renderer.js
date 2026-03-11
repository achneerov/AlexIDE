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
    const { openFolder, listDir, readFile, writeFile } = window.alexide;
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

    document.addEventListener('keydown', function (e) {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveCurrent();
      }
    });
  }
})();
