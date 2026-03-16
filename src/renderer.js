/* global require */
(function () {
  if (window.alexide && window.alexide.getIconDataUrl) {
    window.alexide.getIconDataUrl().then(function (r) {
      if (r && r.ok && r.dataUrl) {
        const link = document.getElementById('favicon');
        if (link) link.href = r.dataUrl;
      }
    });
  }

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
    const { openFolder, listDir, readFile, writeFile, createFile: createFileAPI, createFolder: createFolderAPI, renamePath: renamePathAPI, deletePath: deletePathAPI, terminal: terminalAPI, git: gitAPI } = window.alexide;
    let projectRoot = null;
    let editor = null;
    const openTabs = new Map();
    const tabOrder = [];
    let currentTempTabKey = null;
    let activeFilePath = null;

    const sidebarEl = document.querySelector('.sidebar');
    const sidebarResizer = document.getElementById('sidebar-resizer');
    const editorContainer = document.getElementById('editor-container');
    const editorEmptyState = document.getElementById('editor-empty-state');
    const monacoRoot = document.getElementById('monaco-root');
    const monacoDiffRoot = document.getElementById('monaco-diff-root');
    const diffViewContent = document.getElementById('diff-view-content');
    var diffEditor = null;
    const fileTreeEl = document.getElementById('file-tree');
    const folderPlaceholder = document.getElementById('folder-placeholder');
    const explorerContextMenu = document.getElementById('explorer-context-menu');
    const sidebarPanelExplorer = document.getElementById('sidebar-panel-explorer');
    const sidebarPanelGit = document.getElementById('sidebar-panel-git');
    const gitChangesPlaceholder = document.getElementById('git-changes-placeholder');
    const gitPanelContent = document.getElementById('git-panel-content');
    const gitCommitMessage = document.getElementById('git-commit-message');
    const gitCommitBtn = document.getElementById('git-commit-btn');
    const gitPushBtn = document.getElementById('git-push-btn');
    const gitStagedList = document.getElementById('git-staged-list');
    const gitPendingList = document.getElementById('git-pending-list');
    const gitStagedCount = document.getElementById('git-staged-count');
    const gitPendingCount = document.getElementById('git-pending-count');
    const gitStagedHeader = document.getElementById('git-staged-header');
    const gitUnstageAllBtn = document.getElementById('git-unstage-all-btn');
    const gitPendingHeader = document.getElementById('git-pending-header');
    const gitStageAllBtn = document.getElementById('git-stage-all-btn');
    const gitUndoAllBtn = document.getElementById('git-undo-all-btn');
    const gitFileHistoryHeader = document.getElementById('git-file-history-header');
    const gitFileHistoryList = document.getElementById('git-file-history-list');
    const sidebarPanelSearch = document.getElementById('sidebar-panel-search');
    const searchPlaceholder = document.getElementById('search-placeholder');
    const searchPanelContent = document.getElementById('search-panel-content');
    const searchQueryInput = document.getElementById('search-query-input');
    const searchIncludeFilenames = document.getElementById('search-include-filenames');
    const searchIncludeContents = document.getElementById('search-include-contents');
    const searchResults = document.getElementById('search-results');
    const tabsEl = document.getElementById('tabs');
    const statusPosition = document.getElementById('status-position');
    const ideEl = document.querySelector('.ide');
    const terminalPanel = document.getElementById('terminal-panel');
    const panelResizer = document.getElementById('panel-resizer');
    const panelToggle = document.getElementById('panel-toggle');
    const branchSwitcherTrigger = document.getElementById('branch-switcher-trigger');
    const branchSwitcherDropdown = document.getElementById('branch-switcher-dropdown');
    const terminalView = document.getElementById('terminal-view');
    const terminalTabsEl = document.getElementById('terminal-tabs');
    const panelAddTerminalBtn = document.getElementById('panel-add-terminal');

    var terminals = [];
    var activeTerminalId = null;
    var terminalDataListenerRegistered = false;
    const SIDEBAR_WIDTH_KEY = 'alexide-sidebar-width';
    const DEFAULT_SIDEBAR_WIDTH = 260;
    const MIN_SIDEBAR_WIDTH = 180;
    const MAX_SIDEBAR_WIDTH = 480;
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
        contextmenu: false,
      });
      editor.onDidChangeCursorPosition(function (e) {
        const pos = e.position;
        statusPosition.textContent = 'Ln ' + pos.lineNumber + ', Col ' + pos.column;
      });
      editor.onDidChangeModelContent(function () {
        const path = activeFilePath;
        if (path && openTabs.has(path)) {
          const tab = openTabs.get(path);
          if (!tab.isDiff) { tab.dirty = true; updateTabLabel(path); }
        }
      });
      return editor;
    }

    function renderDiffHtml(chunks) {
      if (!chunks || !chunks.length) return '<div class="diff-empty">No changes</div>';
      var html = [];
      var oldNum = 1;
      var newNum = 1;
      for (var i = 0; i < chunks.length; i++) {
        var c = chunks[i];
        var added = !!c.added;
        var removed = !!c.removed;
        var lines = (c.value || '').split(/\r?\n/);
        if (lines.length === 1 && lines[0] === '' && (added || removed)) continue;
        for (var j = 0; j < lines.length; j++) {
          var line = lines[j];
          var isLast = j === lines.length - 1;
          if (isLast && line === '' && lines.length > 1) continue;
          if (added) {
            html.push('<div class="diff-line diff-line-added"><span class="diff-num">' + newNum + '</span><span class="diff-sign">+</span><span class="diff-content">' + escapeHtml(line) + '</span></div>');
            newNum++;
          } else if (removed) {
            html.push('<div class="diff-line diff-line-removed"><span class="diff-num">' + oldNum + '</span><span class="diff-sign">−</span><span class="diff-content">' + escapeHtml(line) + '</span></div>');
            oldNum++;
          } else {
            html.push('<div class="diff-line diff-line-unchanged"><span class="diff-num">' + oldNum + '</span><span class="diff-sign"> </span><span class="diff-content">' + escapeHtml(line) + '</span></div>');
            oldNum++;
            newNum++;
          }
        }
      }
      return html.join('');
    }

    function updateTabLabel(filePath) {
      const tab = openTabs.get(filePath);
      if (!tab || !tab.el) return;
      const name = tab.name;
      const label = tab.el.querySelector('.label');
      if (label) label.textContent = name;
      tab.el.classList.toggle('dirty', !!tab.dirty);
    }

    function addTab(filePath, content, name, options) {
      options = options || {};
      name = name || filePath.split(/[/\\]/).pop();
      const asTemp = !!options.temp && !options.permanent;

      if (openTabs.has(filePath)) {
        switchToTab(filePath);
        const tab = openTabs.get(filePath);
        if (options.permanent && tab.temp) {
          tab.temp = false;
          currentTempTabKey = currentTempTabKey === filePath ? null : currentTempTabKey;
          if (tab.el) tab.el.classList.remove('temp');
        }
        return;
      }

      if (asTemp && currentTempTabKey != null && openTabs.has(currentTempTabKey)) {
        const tab = openTabs.get(currentTempTabKey);
        if (tab.isDiff) { currentTempTabKey = null; } else {
          tab.model.dispose();
          const language = getLanguage(filePath);
          const model = window.monaco.editor.createModel(content || '', language, window.monaco.Uri.file(filePath));
          const oldKey = currentTempTabKey;
          tab.filePath = filePath;
          tab.name = name;
          tab.model = model;
          tab.dirty = false;
          openTabs.delete(oldKey);
          openTabs.set(filePath, tab);
          const idx = tabOrder.indexOf(oldKey);
          if (idx !== -1) tabOrder[idx] = filePath;
          currentTempTabKey = filePath;
          tab.el.dataset.path = filePath;
          const label = tab.el.querySelector('.label');
          if (label) label.textContent = name;
          tab.el.classList.remove('dirty');
          model.onDidChangeContent(function () {
            tab.dirty = true;
            updateTabLabel(filePath);
          });
          switchToTab(filePath);
          return;
        }
      }

      const language = getLanguage(filePath);
      const model = window.monaco.editor.createModel(content || '', language, window.monaco.Uri.file(filePath));
      const tab = {
        filePath,
        name,
        model,
        dirty: false,
        isDiff: false,
        temp: asTemp,
        el: null,
      };
      openTabs.set(filePath, tab);
      tabOrder.push(filePath);

      const tabEl = document.createElement('div');
      tabEl.className = 'tab' + (tab.temp ? ' temp' : '');
      tabEl.dataset.path = filePath;
      tabEl.draggable = true;
      tabEl.innerHTML = '<span class="label">' + escapeHtml(name) + '</span><button type="button" class="close" aria-label="Close"><span class="close-dot">•</span><span class="close-x">×</span></button>';
      tab.el = tabEl;
      tabsEl.appendChild(tabEl);
      if (asTemp) currentTempTabKey = filePath;

      tabEl.querySelector('.close').addEventListener('click', function (e) {
        e.stopPropagation();
        closeTabWithConfirm(filePath);
      });
      tabEl.addEventListener('click', function (e) {
        if (e.detail === 2) {
          tab.temp = false;
          if (currentTempTabKey === filePath) currentTempTabKey = null;
          tabEl.classList.remove('temp');
        } else {
          switchToTab(filePath);
        }
      });
      tabEl.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', tabEl.dataset.path);
        e.dataTransfer.effectAllowed = 'move';
        tabEl.classList.add('tab-dragging');
      });
      tabEl.addEventListener('dragend', function () {
        tabEl.classList.remove('tab-dragging');
      });
      tabEl.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      tabEl.addEventListener('drop', function (e) {
        e.preventDefault();
        const draggedKey = e.dataTransfer.getData('text/plain');
        const targetKey = tabEl.dataset.path;
        if (!draggedKey || draggedKey === targetKey) return;
        const fromIdx = tabOrder.indexOf(draggedKey);
        const toIdx = tabOrder.indexOf(targetKey);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
        tabOrder.splice(fromIdx, 1);
        const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
        tabOrder.splice(insertIdx, 0, draggedKey);
        syncTabsDOM();
      });

      model.onDidChangeContent(function () {
        tab.dirty = true;
        updateTabLabel(filePath);
      });

      switchToTab(filePath);
    }

    function syncTabsDOM() {
      tabOrder.forEach(function (k) {
        const t = openTabs.get(k);
        if (t && t.el && t.el.parentNode === tabsEl) tabsEl.appendChild(t.el);
      });
    }

    function addDiffTab(fullPath, relativePath, indexContent, workingContent, source) {
      var key = 'diff:' + fullPath + ':' + (source || 'staged');
      if (openTabs.has(key)) {
        switchToTab(key);
        return;
      }
      var name = (relativePath || fullPath).split(/[/\\]/).pop();
      var suffix = (source === 'changes') ? ' (working tree)' : (source && source.indexOf('history:') === 0 ? ' (' + source.slice(8) + ')' : ' (index)');
      var tabLabel = name + suffix;
      var tab = {
        filePath: fullPath,
        name: tabLabel,
        isDiff: true,
        diffChunks: null,
        el: null,
      };
      openTabs.set(key, tab);
      tabOrder.push(key);

      var tabEl = document.createElement('div');
      tabEl.className = 'tab';
      tabEl.dataset.path = key;
      tabEl.draggable = true;
      tabEl.innerHTML = '<span class="label">' + escapeHtml(tabLabel) + '</span><button type="button" class="close" aria-label="Close">×</button>';
      tab.el = tabEl;
      tabsEl.appendChild(tabEl);

      tabEl.querySelector('.close').addEventListener('click', function (e) {
        e.stopPropagation();
        closeTab(key);
      });
      tabEl.addEventListener('click', function () {
        switchToTab(key);
      });
      tabEl.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', key);
        e.dataTransfer.effectAllowed = 'move';
        tabEl.classList.add('tab-dragging');
      });
      tabEl.addEventListener('dragend', function () {
        tabEl.classList.remove('tab-dragging');
      });
      tabEl.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      tabEl.addEventListener('drop', function (e) {
        e.preventDefault();
        var draggedKey = e.dataTransfer.getData('text/plain');
        if (!draggedKey || draggedKey === key) return;
        var fromIdx = tabOrder.indexOf(draggedKey);
        var toIdx = tabOrder.indexOf(key);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
        tabOrder.splice(fromIdx, 1);
        var insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
        tabOrder.splice(insertIdx, 0, draggedKey);
        syncTabsDOM();
      });

      var diffAPI = window.alexide && window.alexide.diff;
      if (!diffAPI || !diffAPI.compute) {
        switchToTab(key);
        return;
      }
      diffAPI.compute(indexContent || '', workingContent || '').then(function (chunks) {
        tab.diffChunks = chunks;
        if (activeFilePath === key && diffViewContent) {
          diffViewContent.innerHTML = renderDiffHtml(chunks);
        }
      }).catch(function () {
        tab.diffChunks = [];
      });
      switchToTab(key);
    }

    function escapeHtml(s) {
      const div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    }

    function getFileIcon(entry) {
      const ext = getExtension(entry.name);
      const colors = window.FILE_ICON_COLORS || {};
      const color = colors[ext] || '#8c8c8c';
      return '<span class="icon icon-file" style="color:' + color + '" aria-hidden="true" data-ext="' + escapeHtml(ext) + '">' +
        '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/></svg></span>';
    }

    function normPath(p) {
      return (p || '').replace(/\\/g, '/');
    }

    function expandFolderNode(wrap) {
      if (wrap.classList.contains('open') && wrap._childNodes) {
        wrap._childNodes.forEach(function (n) { n.style.display = ''; });
        return Promise.resolve();
      }
      if (wrap._childNodes) {
        wrap.classList.add('open');
        const chevronEl = wrap.querySelector('.tree-chevron-cell .tree-chevron');
        if (chevronEl) chevronEl.classList.add('open');
        wrap._childNodes.forEach(function (n) { n.style.display = ''; });
        return Promise.resolve();
      }
      wrap.classList.add('open');
      const chevronEl = wrap.querySelector('.tree-chevron-cell .tree-chevron');
      if (chevronEl) chevronEl.classList.add('open');
      return listDir(wrap.dataset.path).then(function (r) {
        if (!r.ok) return;
        wrap._childNodes = [];
        let insertAfter = wrap;
        const depth = parseInt(wrap.dataset.depth, 10) + 1;
        r.entries.forEach(function (childEntry) {
          insertAfter = createTreeItem(childEntry, depth, fileTreeEl, insertAfter);
          wrap._childNodes.push(insertAfter);
        });
      });
    }

    function expandAncestorsOf(targetPath) {
      if (!projectRoot || !fileTreeEl) return Promise.resolve();
      const target = normPath(targetPath);
      const root = normPath(projectRoot);
      let current = target;
      const ancestors = [];
      while (current && current !== root) {
        const slash = current.lastIndexOf('/');
        if (slash <= 0) break;
        current = current.slice(0, slash);
        ancestors.unshift(current);
      }
      let p = Promise.resolve();
      ancestors.forEach(function (ancestorPath) {
        p = p.then(function () {
          const items = fileTreeEl.querySelectorAll('.tree-item');
          for (let i = 0; i < items.length; i++) {
            if (normPath(items[i].dataset.path) !== ancestorPath) continue;
            if (items[i].dataset.isDir !== 'true') continue;
            return expandFolderNode(items[i]);
          }
        });
      });
      return p;
    }

    function syncExplorerToFile(filePath) {
      if (!filePath || !fileTreeEl || fileTreeEl.style.display === 'none') return;
      fileTreeEl.querySelectorAll('.tree-item-row.active').forEach(function (row) {
        row.classList.remove('active');
      });
      expandAncestorsOf(filePath).then(function () {
        const items = fileTreeEl.querySelectorAll('.tree-item');
        const normalized = normPath(filePath);
        for (let i = 0; i < items.length; i++) {
          if (normPath(items[i].dataset.path) !== normalized) continue;
          const row = items[i].querySelector('.tree-item-row');
          if (row) {
            row.classList.add('active');
            row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          break;
        }
      });
    }

    function switchToTab(filePathOrKey) {
      const tab = openTabs.get(filePathOrKey);
      if (!tab) return;
      activeFilePath = filePathOrKey;
      document.querySelectorAll('.tab').forEach(function (el) {
        el.classList.toggle('open', el.dataset.path === filePathOrKey);
      });
      syncExplorerToFile(tab.filePath);
      if (sidebarPanelGit.style.display !== 'none') refreshFileHistory();
      if (tab.isDiff) {
        if (editorContainer) editorContainer.classList.remove('editor-empty');
        if (monacoRoot) monacoRoot.style.display = 'none';
        if (monacoDiffRoot) monacoDiffRoot.setAttribute('aria-hidden', 'false');
        if (diffViewContent) {
          diffViewContent.innerHTML = tab.diffChunks ? renderDiffHtml(tab.diffChunks) : '<div class="diff-loading">Computing diff…</div>';
        }
        statusPosition.textContent = 'Ln 1, Col 1';
      } else {
        if (editorContainer) editorContainer.classList.remove('editor-empty');
        createEditor();
        if (monacoRoot) monacoRoot.style.display = '';
        if (monacoDiffRoot) monacoDiffRoot.setAttribute('aria-hidden', 'true');
        editor.setModel(tab.model);
        const pos = editor.getPosition();
        if (pos) statusPosition.textContent = 'Ln ' + pos.lineNumber + ', Col ' + pos.column;
      }
    }

    function closeTab(filePathOrKey) {
      const tab = openTabs.get(filePathOrKey);
      if (!tab) return;
      if (currentTempTabKey === filePathOrKey) currentTempTabKey = null;
      const idx = tabOrder.indexOf(filePathOrKey);
      if (idx !== -1) tabOrder.splice(idx, 1);
      if (activeFilePath === filePathOrKey) {
        var next = null;
        if (idx !== -1 && tabOrder.length > 0) {
          var nextIdx = idx < tabOrder.length ? idx : idx - 1;
          next = tabOrder[nextIdx];
        }
        if (next) switchToTab(next);
        else {
          activeFilePath = null;
          if (editorContainer) editorContainer.classList.add('editor-empty');
          if (monacoRoot) monacoRoot.style.display = 'none';
          if (monacoDiffRoot) monacoDiffRoot.setAttribute('aria-hidden', 'true');
          statusPosition.textContent = 'Ln 1, Col 1';
        }
      }
      if (!tab.isDiff) tab.model.dispose();
      if (tab.el && tab.el.parentNode) tab.el.parentNode.removeChild(tab.el);
      openTabs.delete(filePathOrKey);
    }

    function saveTab(filePath) {
      const tab = openTabs.get(filePath);
      if (!tab || tab.isDiff || !tab.model) return Promise.resolve();
      const content = tab.model.getValue();
      return writeFile(filePath, content).then(function (res) {
        if (res.ok) {
          tab.dirty = false;
          updateTabLabel(filePath);
          if (sidebarPanelGit.style.display !== 'none') refreshGitPanel();
        }
        return res;
      });
    }

    function closeTabWithConfirm(filePathOrKey) {
      const tab = openTabs.get(filePathOrKey);
      if (!tab) return;
      if (tab.isDiff || !tab.dirty) {
        closeTab(filePathOrKey);
        return;
      }
      var fileName = (tab.name || '').replace(/\s*•\s*$/, '') || filePathOrKey.split(/[/\\]/).pop();
      window.alexide.showUnsavedCloseDialog(fileName).then(function (result) {
        if (result.response === 0) {
          saveTab(filePathOrKey).then(function () { closeTab(filePathOrKey); });
        } else if (result.response === 1) {
          closeTab(filePathOrKey);
        }
      });
    }

    function openFile(filePath, name, options) {
      readFile(filePath).then(function (res) {
        if (res.ok) addTab(filePath, res.content, name, options);
        else {}
      });
    }

    function openDiffForFile(relativePath, source) {
      if (!projectRoot || !gitAPI) return;
      var relNorm = (relativePath || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '');
      var fullPath = (projectRoot.replace(/\\/g, '/') + '/' + relNorm).replace(/\/+/g, '/');
      var key = 'diff:' + fullPath + ':' + (source || 'staged');
      if (openTabs.has(key)) {
        switchToTab(key);
        return;
      }
      var isStaged = source === 'staged';
      var promise = isStaged
        ? Promise.all([
            gitAPI.showHead(projectRoot, relNorm),
            gitAPI.showIndex(projectRoot, relNorm),
          ]).then(function (results) {
            var oldContent = results[0].ok ? (results[0].content || '') : '';
            var newContent = results[1].ok ? (results[1].content || '') : '';
            return { oldContent: oldContent, newContent: newContent };
          })
        : Promise.all([
            gitAPI.showIndex(projectRoot, relNorm),
            readFile(fullPath),
          ]).then(function (results) {
            var oldContent = results[0].ok ? (results[0].content || '') : '';
            var newContent = results[1].ok ? (results[1].content || '') : '';
            return { oldContent: oldContent, newContent: newContent };
          });
      promise.then(function (data) {
        addDiffTab(fullPath, relNorm, data.oldContent, data.newContent, source || 'staged');
      }).catch(function () {});
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
          if (sidebarPanelGit.style.display !== 'none') refreshGitPanel();
        } else {}
      });
    }

    function createTreeItem(entry, depth, container, insertAfterNode) {
      const wrap = document.createElement('div');
      wrap.className = 'tree-item' + (entry.isDirectory ? ' tree-item-dir' : '');
      wrap.dataset.path = entry.path;
      wrap.dataset.isDir = entry.isDirectory;
      wrap.dataset.depth = depth;
      wrap.draggable = true;

      const row = document.createElement('div');
      row.className = 'tree-item-row';
      row.style.paddingLeft = (depth * 16 + 6) + 'px';
      const isDir = entry.isDirectory;
      const slot1 = '<span class="tree-chevron tree-chevron-spacer" aria-hidden="true"></span>';
      const slot2 = isDir
        ? '<span class="tree-chevron-cell"><span class="tree-chevron" aria-hidden="true">&gt;</span></span>'
        : getFileIcon(entry);
      row.innerHTML = slot1 + slot2 + '<span class="name">' + escapeHtml(entry.name) + '</span>';
      wrap.appendChild(row);

      wrap.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', entry.path);
        e.dataTransfer.setData('application/x-tree-path', entry.path);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('isDirectory', entry.isDirectory ? '1' : '0');
        wrap.classList.add('tree-item-dragging');
      });
      wrap.addEventListener('dragend', function () {
        wrap.classList.remove('tree-item-dragging');
      });

      if (entry.isDirectory) {
        row.addEventListener('dragover', function (e) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          wrap.classList.add('tree-item-drop-target');
        });
        row.addEventListener('dragleave', function () {
          wrap.classList.remove('tree-item-drop-target');
        });
        row.addEventListener('drop', function (e) {
          e.preventDefault();
          e.stopPropagation();
          wrap.classList.remove('tree-item-drop-target');
          var draggedPath = e.dataTransfer.getData('text/plain');
          if (!draggedPath || draggedPath === entry.path) return;
          var dropNorm = normPath(entry.path);
          var draggedNorm = normPath(draggedPath);
          if (draggedNorm === dropNorm || (draggedNorm.length > dropNorm.length && draggedNorm.indexOf(dropNorm + '/') === 0)) return;
          var base = draggedPath.replace(/\\/g, '/').split('/').pop();
          var newPath = (entry.path.replace(/\\/g, '/') + '/' + base).replace(/\/+/g, '/');
          var tab = openTabs.get(draggedPath);
          var isDir = e.dataTransfer.getData('isDirectory') === '1';
          var contentToRestore = (tab && !tab.isDiff && tab.model) ? tab.model.getValue() : null;
          renamePathAPI(draggedPath, newPath).then(function (res) {
            if (res.ok) {
              if (contentToRestore != null) {
                closeTab(draggedPath);
                addTab(newPath, contentToRestore, base);
              } else if (openTabs.has(draggedPath)) {
                closeTab(draggedPath);
              }
              if (isDir) {
                var draggedNorm = normPath(draggedPath);
                var toClose = [];
                openTabs.forEach(function (_t, p) {
                  var pNorm = normPath(p);
                  if (pNorm !== draggedNorm && (pNorm === draggedNorm + '/' || pNorm.indexOf(draggedNorm + '/') === 0)) toClose.push(p);
                });
                toClose.forEach(function (p) { closeTab(p); });
              }
              refreshFileTree();
            }
          });
        });
      }

      if (insertAfterNode) {
        container.insertBefore(wrap, insertAfterNode.nextSibling);
      } else {
        container.appendChild(wrap);
      }

      if (entry.isDirectory) {
        function collapseFolder(node) {
          node.style.display = 'none';
          if (node.classList && node.classList.contains('tree-item-dir') && node._childNodes && node._childNodes.length) {
            node.classList.remove('open');
            const chev = node.querySelector('.tree-chevron-cell .tree-chevron');
            if (chev) chev.classList.remove('open');
            node._childNodes.forEach(collapseFolder);
          }
        }
        row.addEventListener('click', function (e) {
          e.stopPropagation();
          const open = wrap.classList.toggle('open');
          const chevronEl = wrap.querySelector('.tree-chevron-cell .tree-chevron');
          if (chevronEl) chevronEl.classList.toggle('open', open);
          if (wrap._childNodes) {
            if (open) {
              wrap._childNodes.forEach(function (n) { n.style.display = ''; });
            } else {
              wrap._childNodes.forEach(collapseFolder);
            }
            return;
          }
          listDir(entry.path).then(function (r) {
            if (!r.ok) return;
            wrap._childNodes = [];
            let insertAfter = wrap;
            r.entries.forEach(function (childEntry) {
              insertAfter = createTreeItem(childEntry, depth + 1, container, insertAfter);
              wrap._childNodes.push(insertAfter);
            });
          });
        });
      } else {
        row.addEventListener('click', function () {
          var t = setTimeout(function () {
            openFile(entry.path, entry.name, { temp: true });
          }, 250);
          row._openTimeout = t;
        });
        row.addEventListener('dblclick', function () {
          if (row._openTimeout) {
            clearTimeout(row._openTimeout);
            row._openTimeout = null;
          }
          openFile(entry.path, entry.name, { permanent: true });
        });
      }
      return wrap;
    }

    function renderTree(entries, parentPath, container, depth, insertAfterNode) {
      depth = depth || 0;
      let prev = insertAfterNode || null;
      entries.forEach(function (entry) {
        prev = createTreeItem(entry, depth, container, prev);
      });
    }

    function openFolderClicked() {
      openFolder().then(function (folderPath) {
        if (!folderPath) return;
        projectRoot = folderPath;
        folderPlaceholder.style.display = 'none';
        fileTreeEl.style.display = 'block';
        fileTreeEl.innerHTML = '';
        listDir(folderPath).then(function (r) {
          if (r.ok) renderTree(r.entries, folderPath, fileTreeEl, 0);
          else {}
          reinitTerminalToProject(folderPath);
          refreshBranchSwitcher();
        });
      });
    }

    document.getElementById('open-folder-sidebar').addEventListener('click', openFolderClicked);
    if (window.alexide.onMenuOpenFolder) window.alexide.onMenuOpenFolder(openFolderClicked);

    function getParentPath(p) {
      const normalized = (p || '').replace(/\\/g, '/');
      const idx = normalized.lastIndexOf('/');
      return idx <= 0 ? (normalized || p) : normalized.slice(0, idx);
    }

    function refreshFileTree() {
      if (!projectRoot) return;
      listDir(projectRoot).then(function (r) {
        if (!r.ok) return;
        fileTreeEl.innerHTML = '';
        renderTree(r.entries, projectRoot, fileTreeEl, 0);
      });
    }

    function closeContextMenu() {
      if (explorerContextMenu._outsideHandler) {
        document.removeEventListener('mousedown', explorerContextMenu._outsideHandler);
        explorerContextMenu._outsideHandler = null;
      }
      explorerContextMenu.setAttribute('aria-hidden', 'true');
      explorerContextMenu.innerHTML = '';
    }

    function removeNewItemInput() {
      var existing = fileTreeEl.querySelector('.tree-item.new-item-inline');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function findFolderNode(dirPath) {
      if (!fileTreeEl) return null;
      var norm = normPath(dirPath);
      var items = fileTreeEl.querySelectorAll('.tree-item.tree-item-dir');
      for (var i = 0; i < items.length; i++) {
        if (normPath(items[i].dataset.path) === norm) return items[i];
      }
      return null;
    }

    function showNewItemInput(parentDir, kind) {
      removeNewItemInput();
      var wrap = document.createElement('div');
      wrap.className = 'tree-item new-item-inline';
      var row = document.createElement('div');
      row.className = 'tree-item-row';
      var depth = 0;
      var parentNorm = normPath(parentDir || projectRoot);
      var rootNorm = normPath(projectRoot);
      var isInsideFolder = parentNorm !== rootNorm;
      var folderNode = isInsideFolder ? findFolderNode(parentDir) : null;
      if (folderNode) depth = (parseInt(folderNode.dataset.depth, 10) || 0) + 1;
      row.style.paddingLeft = (depth * 16 + 6) + 'px';
      var spacer = document.createElement('span');
      spacer.className = 'tree-chevron tree-chevron-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      spacer.style.marginRight = '5px';
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'new-item-input';
      input.placeholder = kind === 'folder' ? 'Folder name' : 'File name';
      input.setAttribute('autocomplete', 'off');
      row.appendChild(spacer);
      row.appendChild(input);
      wrap.appendChild(row);

      if (isInsideFolder && folderNode) {
        (function (node) {
          expandFolderNode(node).then(function () {
            if (kind === 'folder') {
              fileTreeEl.insertBefore(wrap, node.nextSibling);
            } else {
              var lastDir = null;
              if (node._childNodes) {
                for (var i = 0; i < node._childNodes.length; i++) {
                  if (node._childNodes[i].dataset.isDir === 'true') lastDir = node._childNodes[i];
                }
              }
              fileTreeEl.insertBefore(wrap, lastDir ? lastDir.nextSibling : node.nextSibling);
            }
          }).catch(function () {
            fileTreeEl.insertBefore(wrap, fileTreeEl.firstChild);
          });
        })(folderNode);
      } else {
        if (kind === 'folder') {
          fileTreeEl.insertBefore(wrap, fileTreeEl.firstChild);
        } else {
          var entries = fileTreeEl.querySelectorAll('.tree-item:not(.new-item-inline)');
          var lastRootFolder = null;
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].dataset.depth === '0' && entries[i].dataset.isDir === 'true') lastRootFolder = entries[i];
          }
          fileTreeEl.insertBefore(wrap, lastRootFolder ? lastRootFolder.nextSibling : fileTreeEl.firstChild);
        }
      }

      function insertNewFileAtRoot(fullPath, name) {
        var entries = fileTreeEl.querySelectorAll('.tree-item:not(.new-item-inline)');
        var lastRootFolder = null;
        for (var i = 0; i < entries.length; i++) {
          var el = entries[i];
          if (el.dataset.depth === '0' && el.dataset.isDir === 'true') lastRootFolder = el;
        }
        var newEntry = { path: fullPath, name: name, isDirectory: false };
        var newItem = createTreeItem(newEntry, 0, fileTreeEl, lastRootFolder);
        if (!lastRootFolder) fileTreeEl.insertBefore(newItem, fileTreeEl.firstChild);
      }

      function insertNewFolderAtRoot(fullPath, name) {
        var newEntry = { path: fullPath, name: name, isDirectory: true };
        var newItem = createTreeItem(newEntry, 0, fileTreeEl, null);
        fileTreeEl.insertBefore(newItem, fileTreeEl.firstChild);
      }

      function commit() {
        var name = (input.value || '').trim();
        if (!name) {
          removeNewItemInput();
          return;
        }
        var api = kind === 'folder' ? createFolderAPI : createFileAPI;
        api(parentDir, name).then(function (res) {
          removeNewItemInput();
          if (!res.ok) return;
          var atRoot = normPath(parentDir || projectRoot) === rootNorm;
          if (kind === 'folder' && atRoot) {
            insertNewFolderAtRoot(res.path, name);
          } else if (kind === 'file' && atRoot) {
            insertNewFileAtRoot(res.path, name);
          } else {
            refreshFileTree();
          }
        });
      }

      function cancel() {
        removeNewItemInput();
      }

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      });
      input.addEventListener('blur', function () {
        setTimeout(function () {
          if (wrap.parentNode && (input.value || '').trim() === '') cancel();
        }, 150);
      });
      requestAnimationFrame(function () { input.focus(); });
    }

    window.alexide.onExplorerContextAction(function (payload) {
      var action = payload.action;
      var targetPath = payload.targetPath;
      var parentDir = payload.parentDir;
      if (action === 'new-file') {
        showNewItemInput(parentDir || projectRoot, 'file');
      } else if (action === 'new-folder') {
        showNewItemInput(parentDir || projectRoot, 'folder');
      } else if (action === 'rename' && targetPath) {
        var currentName = targetPath.replace(/\\/g, '/').split('/').pop();
        var newName = prompt('Enter new name', currentName);
        if (!newName || !newName.trim() || newName === currentName) return;
        var newPath = getParentPath(targetPath) + '/' + newName.trim();
        renamePathAPI(targetPath, newPath).then(function (res) {
          if (res.ok) {
            if (openTabs.has(targetPath)) closeTab(targetPath);
            refreshFileTree();
          }
        });
      } else if (action === 'delete' && targetPath) {
        var label = targetPath.replace(/\\/g, '/').split('/').pop();
        if (!confirm('Delete "' + label + '"?')) return;
        deletePathAPI(targetPath).then(function (res) {
          if (res.ok) {
            var targetNorm = targetPath.replace(/\\/g, '/');
            var toClose = [];
            openTabs.forEach(function (_tab, path) {
              var p = path.replace(/\\/g, '/');
              if (p === targetNorm || p.startsWith(targetNorm + '/')) toClose.push(path);
            });
            toClose.forEach(function (path) { closeTab(path); });
            refreshFileTree();
          }
        });
      }
    });

    document.documentElement.addEventListener('contextmenu', function () {
      window.__lastExplorerContextMenuContext = null;
    }, true);

    sidebarPanelExplorer.addEventListener('contextmenu', function (e) {
      if (!projectRoot || fileTreeEl.style.display !== 'block') return;
      var item = e.target.closest('.tree-item');
      var targetPath = item ? item.dataset.path : projectRoot;
      var isDir = item ? (item.dataset.isDir === 'true') : true;
      var parentDir = isDir ? targetPath : getParentPath(targetPath);
      window.__lastExplorerContextMenuContext = {
        projectRoot: projectRoot,
        targetPath: targetPath,
        parentDir: parentDir,
        hasItem: !!item,
      };
    });

    function switchSidebarTab(panel) {
      const isExplorer = panel === 'explorer';
      const isGit = panel === 'git';
      const isSearch = panel === 'search';
      document.getElementById('sidebar-tab-explorer').classList.toggle('open', isExplorer);
      document.getElementById('sidebar-tab-explorer').setAttribute('aria-pressed', isExplorer ? 'true' : 'false');
      document.getElementById('sidebar-tab-git').classList.toggle('open', isGit);
      document.getElementById('sidebar-tab-git').setAttribute('aria-pressed', isGit ? 'true' : 'false');
      document.getElementById('sidebar-tab-search').classList.toggle('open', isSearch);
      document.getElementById('sidebar-tab-search').setAttribute('aria-pressed', isSearch ? 'true' : 'false');
      sidebarPanelExplorer.style.display = isExplorer ? '' : 'none';
      sidebarPanelGit.style.display = isGit ? '' : 'none';
      sidebarPanelSearch.style.display = isSearch ? '' : 'none';
      if (isGit) refreshGitPanel();
      if (isSearch) {
        if (projectRoot) {
          searchPlaceholder.style.display = 'none';
          searchPanelContent.style.display = '';
          if (searchResults) searchResults.innerHTML = '<div class="search-results-empty">Enter a search term and press Enter.</div>';
          if (searchQueryInput) searchQueryInput.focus();
        } else {
          searchPlaceholder.style.display = '';
          searchPanelContent.style.display = 'none';
        }
      }
    }
    document.getElementById('sidebar-tab-explorer').addEventListener('click', function () { switchSidebarTab('explorer'); });
    document.getElementById('sidebar-tab-git').addEventListener('click', function () { switchSidebarTab('git'); });
    document.getElementById('sidebar-tab-search').addEventListener('click', function () { switchSidebarTab('search'); });

    function getAllFiles(dir) {
      return listDir(dir).then(function (r) {
        if (!r.ok) return [];
        var files = [];
        var promises = [];
        (r.entries || []).forEach(function (entry) {
          var name = entry.name || '';
          if (name === '.git' || name === 'node_modules') return;
          if (entry.isDirectory) {
            promises.push(getAllFiles(entry.path).then(function (sub) {
              files.push.apply(files, sub);
            }));
          } else {
            files.push(entry.path);
          }
        });
        return Promise.all(promises).then(function () { return files; });
      });
    }

    function runSearch() {
      if (!projectRoot || !searchResults || !searchQueryInput) return;
      var query = (searchQueryInput.value || '').trim();
      var includeFilenames = searchIncludeFilenames && searchIncludeFilenames.checked;
      var includeContents = searchIncludeContents && searchIncludeContents.checked;
      if (!includeFilenames && !includeContents) {
        searchResults.innerHTML = '<div class="search-results-empty">Enable at least one option.</div>';
        return;
      }
      if (!query) {
        searchResults.innerHTML = '<div class="search-results-empty">Enter a search term.</div>';
        return;
      }
      var qLower = query.toLowerCase();
      searchResults.innerHTML = '<div class="search-results-loading">Searching…</div>';
      getAllFiles(projectRoot).then(function (allFiles) {
        var rootNorm = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
        var matched = [];
        var checkFile = function (filePath) {
          var pathNorm = filePath.replace(/\\/g, '/');
          var name = pathNorm.split('/').pop() || '';
          if (includeFilenames && (name.toLowerCase().indexOf(qLower) !== -1 || pathNorm.toLowerCase().indexOf(qLower) !== -1)) {
            return true;
          }
          if (!includeContents) return false;
          return readFile(filePath).then(function (res) {
            if (!res.ok || res.content == null) return false;
            return res.content.toLowerCase().indexOf(qLower) !== -1;
          });
        };
        var index = 0;
        var next = function () {
          if (index >= allFiles.length) {
            searchResults.innerHTML = '';
            if (matched.length === 0) {
              searchResults.innerHTML = '<div class="search-results-empty">No matches.</div>';
              return;
            }
            matched.forEach(function (filePath) {
              var pathNorm = filePath.replace(/\\/g, '/');
              var rel = pathNorm.indexOf(rootNorm) === 0 ? pathNorm.slice(rootNorm.length).replace(/^\//, '') : pathNorm;
              var name = pathNorm.split('/').pop() || rel;
              var row = document.createElement('div');
              row.className = 'search-result-row';
              row.textContent = rel;
              row.title = filePath;
              row.addEventListener('click', function () {
                openFile(filePath, name, { temp: true });
              });
              searchResults.appendChild(row);
            });
            return;
          }
          var filePath = allFiles[index++];
          var pathNorm = filePath.replace(/\\/g, '/');
          var name = pathNorm.split('/').pop() || '';
          if (includeFilenames && (name.toLowerCase().indexOf(qLower) !== -1 || pathNorm.toLowerCase().indexOf(qLower) !== -1)) {
            matched.push(filePath);
            next();
            return;
          }
          if (!includeContents) {
            next();
            return;
          }
          readFile(filePath).then(function (res) {
            if (res.ok && res.content != null && res.content.toLowerCase().indexOf(qLower) !== -1) {
              matched.push(filePath);
            }
            next();
          }).catch(function () { next(); });
        };
        next();
      }).catch(function () {
        searchResults.innerHTML = '<div class="search-results-empty">Search failed.</div>';
      });
    }

    var searchDebounceTimer = null;
    if (searchQueryInput) {
      searchQueryInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          runSearch();
        }
      });
      searchQueryInput.addEventListener('input', function () {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(runSearch, 320);
      });
    }
    if (searchIncludeFilenames) {
      searchIncludeFilenames.addEventListener('change', runSearch);
    }
    if (searchIncludeContents) {
      searchIncludeContents.addEventListener('change', runSearch);
    }

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        switchSidebarTab('search');
        if (searchQueryInput) {
          searchQueryInput.focus();
        }
      }
    });

    function gitIconAdd() {
      const span = document.createElement('span');
      span.className = 'git-icon';
      span.setAttribute('aria-hidden', 'true');
      span.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M6 2v3h3v2H6v3H4V7H1V5h3V2z"/></svg>';
      return span;
    }
    function gitIconUndo() {
      const span = document.createElement('span');
      span.className = 'git-icon';
      span.setAttribute('aria-hidden', 'true');
      span.innerHTML = '<svg width="12" height="12" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M25 38c-5.1 0-9.7-3-11.8-7.6l1.8-.8c1.8 3.9 5.7 6.4 10 6.4 6.1 0 11-4.9 11-11s-4.9-11-11-11c-4.6 0-8.5 2.8-10.1 7.3l-1.9-.7c1.9-5.2 6.6-8.6 12-8.6 7.2 0 13 5.8 13 13s-5.8 13-13 13z"/><path d="M20 22h-8v-8h2v6h6z"/></svg>';
      return span;
    }

    function renderGitFileRow(filePath, label, actionText, onAction, actionIcon, undoText, onUndo, onOpenDiff) {
      const row = document.createElement('div');
      row.className = 'git-file-row';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = label || filePath.split(/[/\\]/).pop();
      name.title = filePath;
      if (onOpenDiff) name.classList.add('git-file-name-clickable');
      const actions = document.createElement('span');
      actions.className = 'git-file-actions';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action' + (actionIcon ? ' action-icon' : '');
      btn.setAttribute('title', actionText);
      btn.setAttribute('aria-label', actionText);
      if (actionIcon === 'add') btn.appendChild(gitIconAdd());
      else if (actionIcon === 'undo') btn.appendChild(gitIconUndo());
      else btn.textContent = actionText;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        onAction(filePath);
      });
      actions.appendChild(btn);
      if (onUndo && typeof onUndo === 'function') {
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'action action-undo action-icon';
        undoBtn.setAttribute('title', undoText || 'Undo');
        undoBtn.setAttribute('aria-label', undoText || 'Undo');
        undoBtn.appendChild(gitIconUndo());
        undoBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          onUndo(filePath);
        });
        actions.appendChild(undoBtn);
      }
      row.appendChild(name);
      row.appendChild(actions);
      if (onOpenDiff && typeof onOpenDiff === 'function') {
        row.classList.add('git-file-row-open-diff');
        row.addEventListener('click', function (e) {
          if (e.target.closest('.git-file-actions')) return;
          e.preventDefault();
          onOpenDiff(filePath);
        });
      }
      return row;
    }

    function refreshGitPanel() {
      if (!gitAPI) return;
      if (!projectRoot) {
        gitChangesPlaceholder.style.display = '';
        gitChangesPlaceholder.querySelector('p').textContent = 'Open a folder to use Git.';
        gitPanelContent.style.display = 'none';
        gitCommitBtn.disabled = true;
        gitPushBtn.disabled = true;
        refreshBranchSwitcher();
        return;
      }
      gitAPI.status(projectRoot).then(function (res) {
        if (!res.ok) {
          gitChangesPlaceholder.style.display = '';
          gitChangesPlaceholder.querySelector('p').textContent = 'Error: ' + (res.error || 'Unknown');
          gitPanelContent.style.display = 'none';
          gitCommitBtn.disabled = true;
          gitPushBtn.disabled = true;
          refreshBranchSwitcher();
          return;
        }
        if (!res.isRepo) {
          gitChangesPlaceholder.style.display = '';
          gitChangesPlaceholder.querySelector('p').textContent = 'Not a git repository.';
          gitPanelContent.style.display = 'none';
          gitCommitBtn.disabled = true;
          gitPushBtn.disabled = true;
          refreshBranchSwitcher();
          return;
        }
        gitChangesPlaceholder.style.display = 'none';
        gitPanelContent.style.display = '';

        const staged = res.staged || [];
        const unstaged = res.unstaged || [];
        const aheadCount = res.aheadCount != null ? res.aheadCount : 0;
        const hasUpstream = res.hasUpstream !== false;
        const currentBranch = res.currentBranch || null;
        gitStagedCount.textContent = String(staged.length);
        gitPendingCount.textContent = String(unstaged.length);

        gitCommitBtn.disabled = staged.length === 0;
        if (hasUpstream) {
          gitPushBtn.textContent = 'Push';
          gitPushBtn.disabled = aheadCount === 0;
        } else {
          gitPushBtn.textContent = 'Publish Branch';
          gitPushBtn.disabled = !currentBranch;
        }
        gitPushBtn.dataset.hasUpstream = hasUpstream ? '1' : '0';
        gitPushBtn.dataset.currentBranch = currentBranch || '';

        gitUnstageAllBtn.style.display = staged.length > 0 ? '' : 'none';

        gitStagedList.innerHTML = '';
        staged.forEach(function (item) {
          gitStagedList.appendChild(renderGitFileRow(item.path, item.path, 'Unstage', function (p) {
            gitAPI.reset(projectRoot, p).then(function () { refreshGitPanel(); });
          }, 'undo', undefined, undefined, function (p) { openDiffForFile(p, 'staged'); }));
        });

        const showPendingBtns = unstaged.length > 0;
        gitStageAllBtn.style.display = showPendingBtns ? '' : 'none';
        gitUndoAllBtn.style.display = showPendingBtns ? '' : 'none';

        gitPendingList.innerHTML = '';
        unstaged.forEach(function (item) {
          const isNew = item.status === '?';
          const onUndo = function (p) {
            if (isNew) {
              window.alexide.deleteFile(projectRoot, p).then(function (res) {
                if (res.ok) {
                  const fullPath = (projectRoot.replace(/\\/g, '/') + '/' + p.replace(/\\/g, '/')).replace(/\/+/g, '/');
                  if (openTabs.has(fullPath)) closeTab(fullPath);
                  refreshGitPanel();
                } else {}
              });
            } else {
              gitAPI.restore(projectRoot, p).then(function (res) {
                if (res.ok) {
                  const fullPath = (projectRoot.replace(/\\/g, '/') + '/' + p.replace(/\\/g, '/')).replace(/\/+/g, '/');
                  if (openTabs.has(fullPath)) {
                    readFile(fullPath).then(function (r) {
                      if (r.ok) openTabs.get(fullPath).model.setValue(r.content);
                    });
                  }
                  refreshGitPanel();
                } else {}
              });
            }
          };
          gitPendingList.appendChild(renderGitFileRow(item.path, item.path, 'Stage', function (p) {
            gitAPI.add(projectRoot, p).then(function () { refreshGitPanel(); });
          }, 'add', 'Undo', onUndo, function (p) { openDiffForFile(p, 'changes'); }));
        });
        refreshBranchSwitcher();
        refreshFileHistory();
      });
    }

    function refreshFileHistory() {
      if (!gitFileHistoryList || !gitFileHistoryHeader) return;
      if (!projectRoot || !gitAPI || !activeFilePath) {
        gitFileHistoryList.innerHTML = '<div class="git-file-history-empty">No file selected</div>';
        return;
      }
      const tab = openTabs.get(activeFilePath);
      if (tab && tab.isDiff) {
        gitFileHistoryList.innerHTML = '<div class="git-file-history-empty">Select a file to view history</div>';
        return;
      }
      const rootNorm = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
      const fullNorm = activeFilePath.replace(/\\/g, '/');
      if (fullNorm.indexOf(rootNorm) !== 0 || (fullNorm.length > rootNorm.length && fullNorm[rootNorm.length] !== '/')) {
        gitFileHistoryList.innerHTML = '<div class="git-file-history-empty">File is outside project</div>';
        return;
      }
      const relPath = fullNorm.length === rootNorm.length ? '' : fullNorm.slice(rootNorm.length + 1);
      if (!relPath) {
        gitFileHistoryList.innerHTML = '<div class="git-file-history-empty">Select a file to view history</div>';
        return;
      }
      gitFileHistoryList.innerHTML = '<div class="git-file-history-loading">Loading…</div>';
      gitAPI.fileHistory(projectRoot, relPath).then(function (res) {
        if (!res.ok) {
          gitFileHistoryList.innerHTML = '<div class="git-file-history-empty">' + escapeHtml(res.error || 'Failed to load history') + '</div>';
          return;
        }
        const commits = res.commits || [];
        if (commits.length === 0) {
          gitFileHistoryList.innerHTML = '<div class="git-file-history-empty">No history for this file</div>';
          return;
        }
        gitFileHistoryList.innerHTML = '';
        const rootNorm2 = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
        const fullNorm2 = activeFilePath.replace(/\\/g, '/');
        const relPath2 = fullNorm2.length <= rootNorm2.length + 1 ? '' : fullNorm2.slice(rootNorm2.length + 1);
        commits.forEach(function (c, index) {
          const dateStr = c.date ? c.date.slice(0, 10) : '';
          const row = document.createElement('div');
          row.className = 'git-file-history-row';
          row.dataset.rev = c.shortHash;
          row.dataset.index = String(index);
          row.innerHTML = '<span class="git-file-history-hash">' + escapeHtml(c.shortHash) + '</span> ' +
            '<span class="git-file-history-subject">' + escapeHtml(c.subject) + '</span> ' +
            '<span class="git-file-history-date">' + escapeHtml(dateStr) + '</span>';
          row.addEventListener('click', function () {
            const idx = parseInt(row.dataset.index, 10);
            const newRev = commits[idx].shortHash;
            const prevRev = commits[idx + 1] ? commits[idx + 1].shortHash : null;
            const fullPath = (rootNorm2 + '/' + relPath2).replace(/\/+/g, '/');
            const key = 'diff:' + fullPath + ':history:' + newRev;
            if (openTabs.has(key)) {
              switchToTab(key);
              return;
            }
            function openHistoryDiff(oldContent, newContent, labelRev) {
              addDiffTab(fullPath, relPath2, oldContent, newContent, 'history:' + labelRev);
            }
            if (prevRev) {
              Promise.all([
                gitAPI.showRevision(projectRoot, relPath2, prevRev),
                gitAPI.showRevision(projectRoot, relPath2, newRev),
              ]).then(function (results) {
                const oldContent = results[0].ok ? (results[0].content || '') : '';
                const newContent = results[1].ok ? (results[1].content || '') : '';
                openHistoryDiff(oldContent, newContent, newRev);
              });
            } else {
              gitAPI.showRevision(projectRoot, relPath2, newRev).then(function (r) {
                const newContent = r.ok ? (r.content || '') : '';
                openHistoryDiff('', newContent, newRev);
              });
            }
          });
          gitFileHistoryList.appendChild(row);
        });
      });
    }

    document.getElementById('git-unstage-all-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (!projectRoot || !gitAPI) return;
      gitAPI.resetAll(projectRoot).then(function (res) {
        if (res.ok) refreshGitPanel();
        else {}
      });
    });

    document.getElementById('git-stage-all-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (!projectRoot || !gitAPI) return;
      gitAPI.addAll(projectRoot).then(function (res) {
        if (res.ok) refreshGitPanel();
        else {}
      });
    });

    document.getElementById('git-undo-all-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (!projectRoot || !gitAPI) return;
      gitAPI.status(projectRoot).then(function (res) {
        if (!res.ok || !res.unstaged || res.unstaged.length === 0) return;
        let chain = Promise.resolve();
        res.unstaged.forEach(function (item) {
          chain = chain.then(function () {
            if (item.status === '?') {
              return window.alexide.deleteFile(projectRoot, item.path).then(function (delRes) {
                if (delRes.ok) {
                  const fullPath = (projectRoot.replace(/\\/g, '/') + '/' + item.path.replace(/\\/g, '/')).replace(/\/+/g, '/');
                  if (openTabs.has(fullPath)) closeTab(fullPath);
                }
              });
            }
            return gitAPI.restore(projectRoot, item.path).then(function (restoreRes) {
              if (restoreRes.ok) {
                const fullPath = (projectRoot.replace(/\\/g, '/') + '/' + item.path.replace(/\\/g, '/')).replace(/\/+/g, '/');
                if (openTabs.has(fullPath)) {
                  return readFile(fullPath).then(function (r) {
                    if (r.ok) openTabs.get(fullPath).model.setValue(r.content);
                  });
                }
              }
            });
          });
        });
        return chain.then(function () { refreshGitPanel(); });
      });
    });

    gitStagedHeader.addEventListener('click', function () {
      const expanded = gitStagedHeader.getAttribute('aria-expanded') !== 'false';
      gitStagedHeader.setAttribute('aria-expanded', !expanded);
      gitStagedList.classList.toggle('collapsed', expanded);
    });
    gitPendingHeader.addEventListener('click', function () {
      const expanded = gitPendingHeader.getAttribute('aria-expanded') !== 'false';
      gitPendingHeader.setAttribute('aria-expanded', !expanded);
      gitPendingList.classList.toggle('collapsed', expanded);
    });
    if (gitFileHistoryHeader) {
      gitFileHistoryHeader.addEventListener('click', function () {
        const expanded = gitFileHistoryHeader.getAttribute('aria-expanded') !== 'false';
        gitFileHistoryHeader.setAttribute('aria-expanded', !expanded);
        gitFileHistoryList.classList.toggle('collapsed', expanded);
      });
    }

    gitCommitBtn.addEventListener('click', function () {
      if (!projectRoot || !gitAPI) return;
      const msg = gitCommitMessage.value.trim();
      if (!msg) {
        return;
      }
      gitAPI.commit(projectRoot, msg).then(function (res) {
        if (res.ok) {
          gitCommitMessage.value = '';
          refreshGitPanel();
        } else {
          {}
        }
      });
    });

    gitPushBtn.addEventListener('click', function () {
      if (!projectRoot || !gitAPI) return;
      var hasUpstream = gitPushBtn.dataset.hasUpstream === '1';
      var branch = gitPushBtn.dataset.currentBranch || '';
      var promise = hasUpstream ? gitAPI.push(projectRoot) : gitAPI.pushSetUpstream(projectRoot, branch);
      promise.then(function (res) {
        if (res.ok) {
          refreshGitPanel();
        } else {
          if (res.error) console.warn('Git push failed:', res.error);
        }
      });
    });

    function getStoredSidebarWidth() {
      const v = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= MIN_SIDEBAR_WIDTH && n <= MAX_SIDEBAR_WIDTH ? n : DEFAULT_SIDEBAR_WIDTH;
    }
    function setSidebarWidth(w) {
      const width = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, w));
      sidebarEl.style.width = width + 'px';
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    }
    setSidebarWidth(getStoredSidebarWidth());

    sidebarResizer.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarEl.offsetWidth;
      function onMouseMove(ev) {
        setSidebarWidth(startWidth + (ev.clientX - startX));
      }
      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveCurrent();
      } else if (e.key === 'w' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (document.activeElement && (document.activeElement.closest('input') || document.activeElement.closest('textarea'))) return;
        e.preventDefault();
        if (activeFilePath) closeTabWithConfirm(activeFilePath);
      }
    });

    function getStoredPanelHeight() {
      const v = localStorage.getItem(PANEL_HEIGHT_KEY);
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= MIN_PANEL_HEIGHT ? n : DEFAULT_PANEL_HEIGHT;
    }

    function getActiveTerminal() {
      return terminals.find(function (t) { return t.id === activeTerminalId; }) || terminals[0];
    }

    function setPanelHeight(h) {
      const max = window.innerHeight * MAX_PANEL_HEIGHT_PERCENT;
      const height = Math.max(MIN_PANEL_HEIGHT, Math.min(max, h));
      terminalPanel.style.height = height + 'px';
      localStorage.setItem(PANEL_HEIGHT_KEY, String(height));
      scheduleTerminalFit();
    }

    function setPanelCollapsed(collapsed) {
      terminalPanel.classList.toggle('collapsed', collapsed);
      ideEl.classList.toggle('panel-collapsed', collapsed);
      terminalPanel.style.height = collapsed ? (PANEL_BAR_HEIGHT + 'px') : (getStoredPanelHeight() + 'px');
      localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? '1' : '0');
      panelToggle.textContent = collapsed ? '+' : '−';
      panelToggle.setAttribute('aria-label', collapsed ? 'Show terminal panel' : 'Minimize terminal panel');
      if (!collapsed) scheduleTerminalFit();
    }

    function togglePanel() {
      const collapsed = terminalPanel.classList.contains('collapsed');
      setPanelCollapsed(!collapsed);
      if (!collapsed) initTerminal();
    }

    function updateTerminalTabBarVisibility() {
      if (terminals.length >= 2) terminalTabsEl.classList.add('visible');
      else terminalTabsEl.classList.remove('visible');
    }

    var terminalFitScheduled = false;
    function scheduleTerminalFit() {
      if (terminalFitScheduled) return;
      terminalFitScheduled = true;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          terminalFitScheduled = false;
          var active = getActiveTerminal();
          if (active && active.fitAddon && active.xterm && !terminalPanel.classList.contains('collapsed')) {
            try {
              active.fitAddon.fit();
              if (typeof active.xterm.scrollToBottom === 'function') {
                active.xterm.scrollToBottom();
              }
              terminalAPI.resize(active.id, active.xterm.cols, active.xterm.rows);
            } catch (_) {}
          }
        });
      });
    }

    function setActiveTerminal(terminalId) {
      activeTerminalId = terminalId;
      terminals.forEach(function (t) {
        t.containerEl.classList.toggle('active', t.id === terminalId);
        t.tabEl.classList.toggle('active', t.id === terminalId);
      });
      scheduleTerminalFit();
    }

    function closeTerminal(terminalId) {
      var idx = terminals.findIndex(function (t) { return t.id === terminalId; });
      if (idx === -1) return;
      var t = terminals[idx];
      terminalAPI.kill(terminalId);
      try { if (t.xterm) t.xterm.destroy(); } catch (_) {}
      if (t.tabEl && t.tabEl.parentNode) t.tabEl.parentNode.removeChild(t.tabEl);
      if (t.containerEl && t.containerEl.parentNode) t.containerEl.parentNode.removeChild(t.containerEl);
      terminals.splice(idx, 1);
      if (terminals.length === 0) {
        activeTerminalId = null;
        updateTerminalTabBarVisibility();
        return;
      }
      if (activeTerminalId === terminalId) {
        var next = terminals[idx] || terminals[idx - 1];
        setActiveTerminal(next.id);
      }
      updateTerminalTabBarVisibility();
    }

    function flushTerminalWriteBuffer(term) {
      if (!term.xterm || !term.writeBuffer || term.writeBuffer.length === 0) return;
      term.rafScheduled = false;
      var s = term.writeBuffer.join('');
      term.writeBuffer.length = 0;
      try {
        term.xterm.write(s);
      } catch (_) {}
    }

    function scheduleTerminalWrite(term, data) {
      if (!term.writeBuffer) term.writeBuffer = [];
      term.writeBuffer.push(data);
      if (term.rafScheduled) return;
      term.rafScheduled = true;
      var t = term;
      requestAnimationFrame(function () {
        flushTerminalWriteBuffer(t);
      });
    }

    function createTerminalUIAndBackend(cwd) {
      const Terminal = window.Terminal;
      const FitAddonCtor = window.FitAddon?.FitAddon || window.FitAddon;
      if (!Terminal || !FitAddonCtor) return null;
      var containerEl = document.createElement('div');
      containerEl.className = 'terminal-instance';
      terminalView.appendChild(containerEl);

      var xterm = new Terminal({
        theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
        fontFamily: 'SF Mono, Monaco, Cascadia Code, Menlo, Consolas, monospace',
        fontSize: 13,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 1000,
        allowProposedApi: false,
      });
      var fitAddon = new FitAddonCtor();
      xterm.loadAddon(fitAddon);
      xterm.open(containerEl);

      if (!terminalDataListenerRegistered) {
        terminalAPI.onData(function (terminalId, data) {
          var term = terminals.find(function (t) { return t.id === terminalId; });
          if (term && term.xterm) scheduleTerminalWrite(term, data);
        });
        terminalDataListenerRegistered = true;
      }

      if (!terminalView._resizeObserver) {
        terminalView._resizeObserver = new ResizeObserver(function () {
          scheduleTerminalFit();
        });
        terminalView._resizeObserver.observe(terminalView);
      }

      terminalAPI.create(cwd || undefined).then(function (res) {
        if (!res.ok) {
          xterm.writeln('Terminal error: ' + (res.error || 'Unknown'));
          return;
        }
        var shellName = res.shellName || 'sh';
        var terminalId = res.terminalId;
        var tabEl = document.createElement('div');
        tabEl.className = 'terminal-tab' + (activeTerminalId === null ? ' active' : '');
        tabEl.dataset.terminalId = terminalId;
        tabEl.setAttribute('role', 'button');
        tabEl.setAttribute('aria-label', 'Terminal ' + shellName);
        tabEl.innerHTML = '<span class="tab-label">' + escapeHtml(shellName) + '</span><button type="button" class="tab-close" aria-label="Close">×</button>';
        var closeBtn = tabEl.querySelector('.tab-close');
        closeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          closeTerminal(terminalId);
        });
        tabEl.addEventListener('click', function (e) {
          if (e.target === closeBtn) return;
          setActiveTerminal(terminalId);
        });
        terminalTabsEl.appendChild(tabEl);

        var termObj = {
          id: terminalId,
          shellName: shellName,
          xterm: xterm,
          fitAddon: fitAddon,
          containerEl: containerEl,
          tabEl: tabEl,
          writeBuffer: [],
          rafScheduled: false,
        };
        terminals.push(termObj);
        if (activeTerminalId === null) {
          activeTerminalId = terminalId;
          containerEl.classList.add('active');
        } else {
          setActiveTerminal(terminalId);
        }
        updateTerminalTabBarVisibility();

        xterm.onData(function (data) {
          terminalAPI.sendInput(terminalId, data);
        });
        if (typeof xterm.onTitleChange === 'function') {
          xterm.onTitleChange(function (title) {
            var label = tabEl.querySelector('.tab-label');
            if (!label) return;
            var s = (title && String(title).trim()) ? String(title).trim() : shellName;
            label.textContent = s;
            tabEl.setAttribute('aria-label', 'Terminal ' + s);
          });
        }
        scheduleTerminalFit();
      });
      return null;
    }

    function addNewTerminal() {
      createTerminalUIAndBackend(projectRoot || undefined);
    }

    function initTerminal() {
      if (terminals.length > 0) return;
      createTerminalUIAndBackend(projectRoot || undefined);
    }

    function reinitTerminalToProject(folderPath) {
      if (!folderPath) return;
      if (terminals.length === 0) return;
      terminalAPI.killAll().then(function () {
        terminals.forEach(function (t) {
          try { if (t.xterm) t.xterm.destroy(); } catch (_) {}
          if (t.tabEl && t.tabEl.parentNode) t.tabEl.parentNode.removeChild(t.tabEl);
          if (t.containerEl && t.containerEl.parentNode) t.containerEl.parentNode.removeChild(t.containerEl);
        });
        terminals = [];
        activeTerminalId = null;
        terminalView.innerHTML = '';
        terminalTabsEl.innerHTML = '';
        terminalTabsEl.classList.remove('visible');
        createTerminalUIAndBackend(folderPath);
      });
    }

    const collapsedStored = localStorage.getItem(PANEL_COLLAPSED_KEY) === '1';
    const initialHeight = getStoredPanelHeight();
    terminalPanel.style.height = initialHeight + 'px';
    setPanelCollapsed(collapsedStored);
    if (!collapsedStored) initTerminal();

    panelToggle.addEventListener('click', togglePanel);
    if (window.alexide.onMenuToggleTerminal) window.alexide.onMenuToggleTerminal(togglePanel);
    if (panelAddTerminalBtn) panelAddTerminalBtn.addEventListener('click', addNewTerminal);

    function refreshBranchSwitcher() {
      if (!branchSwitcherTrigger || !branchSwitcherDropdown) return;
      if (!projectRoot) {
        branchSwitcherTrigger.textContent = 'No branch';
        branchSwitcherDropdown.innerHTML = '';
        return;
      }
      gitAPI.branches(projectRoot).then(function (res) {
        if (!res.ok || !res.isRepo) {
          branchSwitcherTrigger.textContent = 'No branch';
          branchSwitcherDropdown.innerHTML = '';
          return;
        }
        var current = res.current || 'No branch';
        branchSwitcherTrigger.textContent = current + ' ▼';
        branchSwitcherTrigger.setAttribute('aria-label', 'Current branch: ' + current);
        branchSwitcherDropdown.innerHTML = '';
        res.branches.forEach(function (branch) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'branch-switcher-option' + (branch === current ? ' current' : '');
          btn.textContent = branch;
          btn.setAttribute('role', 'option');
          btn.addEventListener('click', function () {
            if (branch === current) { closeBranchDropdown(); return; }
            var targetBranch = branch;
            gitAPI.checkout(projectRoot, targetBranch).then(function (checkoutRes) {
              if (checkoutRes.ok) {
                closeBranchDropdown();
                refreshBranchSwitcher();
                refreshGitPanel();
                refreshFileTree();
                return;
              }
              var errMsg = (checkoutRes.error || '').toLowerCase();
              var needsStash = errMsg.indexOf('overwritten') !== -1 || errMsg.indexOf('your local changes') !== -1 || (errMsg.indexOf('stash') !== -1 && errMsg.indexOf('commit') !== -1);
              if (needsStash) {
                closeBranchDropdown();
                window.alexide.git.showStashCommandDialog();
              } else {
                closeBranchDropdown();
              }
            });
          });
          branchSwitcherDropdown.appendChild(btn);
        });
      });
    }
    function closeBranchDropdown() {
      if (branchSwitcherDropdown) {
        branchSwitcherDropdown.setAttribute('aria-hidden', 'true');
        branchSwitcherTrigger.setAttribute('aria-expanded', 'false');
      }
    }
    function openBranchDropdown() {
      if (!branchSwitcherTrigger || !branchSwitcherDropdown) return;
      var isOpen = branchSwitcherDropdown.getAttribute('aria-hidden') !== 'true';
      if (isOpen) {
        closeBranchDropdown();
        return;
      }
      branchSwitcherDropdown.setAttribute('aria-hidden', 'false');
      branchSwitcherTrigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', function outside(e) {
        if (!branchSwitcherTrigger.contains(e.target) && !branchSwitcherDropdown.contains(e.target)) {
          closeBranchDropdown();
          document.removeEventListener('click', outside);
        }
      });
    }
    if (branchSwitcherTrigger) branchSwitcherTrigger.addEventListener('click', function (e) {
      e.stopPropagation();
      openBranchDropdown();
    });
    if (branchSwitcherDropdown) branchSwitcherDropdown.addEventListener('click', function (e) { e.stopPropagation(); });
    window.addEventListener('focus', function () {
      refreshBranchSwitcher();
    });
    setInterval(function () {
      if (!projectRoot) return;
      refreshBranchSwitcher();
      if (sidebarPanelGit && sidebarPanelGit.style.display !== 'none') {
        refreshGitPanel();
      }
    }, 2000);

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
      scheduleTerminalFit();
    });
  }
})();
