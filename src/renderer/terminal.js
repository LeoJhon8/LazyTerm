class Tab {
  constructor(id, title = 'Terminal', connectionType = 'local', connectionParams = null) {
    this.id = id;
    this.title = title;
    this.connectionType = connectionType;
    this.connectionParams = connectionParams;
    this.content = this.getInitialContent();
    this.commandHistory = [];
    this.historyIndex = -1;
    this.isExecuting = false;
    this.scrollTop = undefined;
    this.sshSessionId = null;
    this.sessionId = null;
    this.xtermWrapper = null;
  }

  getInitialContent() {
    if (this.connectionType === 'local') {
      return [
        { text: 'Lazy Terminal v1.0.0', className: '' },
        { text: "Type 'help' for available commands", className: '' },
        { text: '', className: '' }
      ];
    } else if (this.connectionType === 'ssh') {
      return [
        { text: `SSH Connection to ${this.connectionParams?.host || 'unknown'}`, className: 'info' },
        { text: '', className: '' }
      ];
    } else if (this.connectionType === 'telnet') {
      return [
        { text: `Telnet Connection to ${this.connectionParams?.host || 'unknown'}:${this.connectionParams?.port || 23}`, className: 'info' },
        { text: '', className: '' }
      ];
    }
    return [];
  }

  setContent(content) {
    this.content = content;
  }

  addLine(text, className = '') {
    this.content.push({ text, className });
  }

  addCommand(command) {
    this.commandHistory.push(command);
    this.historyIndex = -1;
  }

  clearContent() {
    this.content = [];
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      connectionType: this.connectionType,
      connectionParams: this.connectionParams,
      content: this.content,
      commandHistory: this.commandHistory,
      historyIndex: this.historyIndex,
      scrollTop: this.scrollTop,
      sessionId: this.sessionId
    };
  }

  static fromJSON(data) {
    const tab = new Tab(data.id, data.title, data.connectionType || 'local', data.connectionParams);
    tab.content = data.content || [];
    tab.commandHistory = data.commandHistory || [];
    tab.historyIndex = data.historyIndex || -1;
    tab.scrollTop = data.scrollTop;
    return tab;
  }
}

class TabManager {
  constructor() {
    this.tabs = [];
    this.activeTabId = null;
    this.nextTabId = 1;

    this.terminalWrapper = document.getElementById('terminalWrapper');
    this.tabsWrapper = document.getElementById('tabsWrapper');
    this.newTabBtn = document.getElementById('newTabBtn');

    this.defaultFontSize = 14;
    this.minFontSize = 10;
    this.maxFontSize = 24;
    this.fontSize = this.loadFontSize();

    this.globalCommandHistory = this.loadGlobalCommandHistory();
    this.maxHistorySize = 200;

    // 快捷命令相关
    this.defaultShortcuts = [
      { label: 'help', command: 'help', alias: 'help' },
      { label: 'clear', command: 'clear', alias: 'clear' },
      { label: 'history', command: 'history', alias: 'history' },
      { label: 'dir', command: 'dir', alias: 'dir' },
      { label: 'pwd', command: 'pwd', alias: 'pwd' },
      { label: 'echo', command: 'echo $USERPROFILE', alias: 'echo' }
    ];
    this.shortcuts = this.loadShortcuts();
    this.draggedShortcut = null;
    this.editingShortcutIndex = null;
    this.contextMenuTargetIndex = null;
    this.editingShortcutIndex = -1;

    this.savedSessions = [];
    this.draggedSessionIndex = null;

    this.init();
  }

  get activeTab() {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  init() {
    try {
      console.log('[TabManager] Initializing...');
      localStorage.removeItem('terminalTabs');

      this.initPTYListeners();
      this.createTab();

      console.log('[TabManager] Initializing event listeners...');
      this.initEventListeners();
      console.log('[TabManager] Initializing shortcut bar...');
      this.initShortcutBar();
      console.log('[TabManager] Initializing session sidebar...');
      this.initSessionSidebar();
      console.log('[TabManager] Initializing history sidebar...');
      this.initHistorySidebar();
      this.initFontSizeControls();
      this.initConnectionModal();
      console.log('[TabManager] Initialization complete!');
    } catch (e) {
      console.error('[TabManager] Initialization failed:', e);
      console.error('[TabManager] Stack trace:', e.stack);
    }
  }

  initPTYListeners() {
    window.electronAPI.onPtyData((event, { sessionId, data }) => {
      const tab = this.tabs.find(t => t.sessionId === sessionId);
      if (tab && tab.xtermWrapper) {
        tab.xtermWrapper.write(data);
      }
    });

    window.electronAPI.onPtyExit((event, { sessionId, code }) => {
      console.log(`PTY session ${sessionId} exited with code ${code}`);
    });

    window.electronAPI.onPtyError((event, { sessionId, error }) => {
      console.error(`PTY session ${sessionId} error: ${error}`);
      const tab = this.tabs.find(t => t.sessionId === sessionId);
      if (tab && tab.xtermWrapper) {
        tab.xtermWrapper.writeln(`\r\n\x1b[31mPTY Error: ${error}\x1b[0m\r\n`);
      }
    });
  }

  initEventListeners() {
    console.log('[initEventListeners] Setting up event listeners...');

    this.terminalWrapper.addEventListener('click', () => {
      this.hideContextMenu();
    });

    console.log('[initEventListeners] newTabBtn:', this.newTabBtn);
    if (this.newTabBtn) {
      this.newTabBtn.addEventListener('click', () => {
        console.log('[newTabBtn] Clicked!');
        this.createTab();
      });
    } else {
      console.error('[initEventListeners] newTabBtn not found!');
    }

    // 滚轮字体大小
    this.terminalWrapper.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          this.increaseFontSize();
        } else {
          this.decreaseFontSize();
        }
      }
    });

    console.log('[initEventListeners] Event listeners set up complete!');
  }

  async createTab(title = null, connectionType = 'local', connectionParams = null) {
    const id = this.nextTabId++;
    const tabTitle = title || 'Lazy Terminal';
    const tab = new Tab(id, tabTitle, connectionType, connectionParams);
    this.tabs.push(tab);
    this.activeTabId = id;
    this.renderTabs();
    this.loadActiveTab();

    const xtermContainer = document.getElementById('xterm-container');
    xtermContainer.innerHTML = '';

    const { default: XtermWrapper } = await import('./xtermWrapper.js');
    const xtermWrapper = new XtermWrapper(xtermContainer, {
      fontSize: this.fontSize
    });
    tab.xtermWrapper = xtermWrapper;

    let ptyType = 'local';
    let ptyParams = { tabId: id };

    if (connectionType === 'ssh' && connectionParams) {
      ptyType = 'ssh';
      ptyParams = {
        tabId: id,
        host: connectionParams.host,
        port: connectionParams.port,
        user: connectionParams.user,
        password: connectionParams.password,
        keyPath: connectionParams.keyPath
      };
    }

    try {
      const result = await window.electronAPI.ptyCreate(ptyType, ptyParams);
      if (result.success) {
        tab.sessionId = result.sessionId;
        window.electronAPI.ptySetTab(result.sessionId, id);
        xtermWrapper.setSession(result.sessionId);
        xtermWrapper.connect();
      }
    } catch (error) {
      console.error('Failed to create PTY session:', error);
      xtermWrapper.writeln(`\r\n\x1b[31mFailed to create session: ${error.message}\x1b[0m\r\n`);
    }

    this.saveState();
    return tab;
  }

  async closeTab(id, e) {
    if (e) e.stopPropagation();

    if (this.tabs.length === 1) {
      return;
    }

    const tabIndex = this.tabs.findIndex(t => t.id === id);
    const tab = this.tabs[tabIndex];

    if (tab && tab.sessionId) {
      await window.electronAPI.ptyClose(tab.sessionId);
    }

    if (tab && tab.xtermWrapper) {
      tab.xtermWrapper.destroy();
    }

    this.tabs.splice(tabIndex, 1);

    if (this.activeTabId === id) {
      const newIndex = Math.min(tabIndex, this.tabs.length - 1);
      this.activeTabId = this.tabs[newIndex].id;
      this.loadActiveTab();
    }

    this.renderTabs();
    this.saveState();
  }

  switchTab(id) {
    if (this.activeTabId === id) return;

    const currentTab = this.activeTab;
    this.activeTabId = id;
    this.renderTabs();
    this.loadActiveTab();
  }

  renameTab(id, newTitle) {
    const tab = this.tabs.find(t => t.id === id);
    if (tab) {
      tab.title = newTitle;
      this.renderTabs();
      this.saveState();
    }
  }

  renderTabs() {
    this.tabsWrapper.innerHTML = '';

    this.tabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.className = `tab ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabEl.innerHTML = `
        <span class="tab-title">${tab.title}</span>
        ${this.tabs.length > 1 ? `<span class="tab-close" data-tab-id="${tab.id}">&times;</span>` : ''}
      `;

      tabEl.addEventListener('click', () => this.switchTab(tab.id));

      const closeBtn = tabEl.querySelector('.tab-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => this.closeTab(tab.id, e));
      }

      // 双击重命名
      tabEl.addEventListener('dblclick', () => {
        const newTitle = prompt('Enter new tab name:', tab.title);
        if (newTitle && newTitle.trim()) {
          this.renameTab(tab.id, newTitle.trim());
        }
      });

      this.tabsWrapper.appendChild(tabEl);
    });
  }

  loadActiveTab() {
    const tab = this.activeTab;
    if (!tab) return;

    if (tab.xtermWrapper) {
      tab.xtermWrapper.setFontSize(this.fontSize);
      tab.xtermWrapper.focus();
    }
  }

    saveActiveTabState() {
    const tab = this.activeTab;
    if (!tab) return;
    // PTY sessions don't need content persistence
  }

  saveState() {
    // Save tabs config only (not PTY content)
    const state = {
      tabs: this.tabs.map(t => t.toJSON()),
      activeTabId: this.activeTabId,
      nextTabId: this.nextTabId
    };
    localStorage.setItem('terminalTabs', JSON.stringify(state));
  }

  loadState() {
    const saved = localStorage.getItem('terminalTabs');
    if (saved) {
      try {
        const state = JSON.parse(saved);
        this.tabs = state.tabs.map(d => Tab.fromJSON(d));
        this.activeTabId = state.activeTabId;
        this.nextTabId = state.nextTabId || this.tabs.length + 1;
      } catch (e) {
        console.error('Failed to load tabs state:', e);
        this.tabs = [];
      }
    }
  }

  // 字体大小相关方法
  loadFontSize() {
    try {
      const saved = localStorage.getItem('terminalFontSize');
      const size = saved ? parseInt(saved, 10) : this.defaultFontSize;
      return isNaN(size) ? this.defaultFontSize : size;
    } catch (e) {
      console.error('Failed to load font size, using default:', e);
      return this.defaultFontSize;
    }
  }

  saveFontSize() {
    localStorage.setItem('terminalFontSize', this.fontSize.toString());
  }

  applyFontSize() {
    // Legacy method - xterm.js handles font size via setFontSize()
  }

  increaseFontSize() {
    if (this.fontSize < this.maxFontSize) {
      this.fontSize += 2;
      const tab = this.activeTab;
      if (tab && tab.xtermWrapper) {
        tab.xtermWrapper.setFontSize(this.fontSize);
      }
      this.saveFontSize();
      setTimeout(() => {
        const tab = this.activeTab;
        if (tab && tab.xtermWrapper) {
          tab.xtermWrapper.focus();
        }
      }, 0);
    }
  }

  decreaseFontSize() {
    if (this.fontSize > this.minFontSize) {
      this.fontSize -= 2;
      const tab = this.activeTab;
      if (tab && tab.xtermWrapper) {
        tab.xtermWrapper.setFontSize(this.fontSize);
      }
      this.saveFontSize();
      setTimeout(() => {
        const tab = this.activeTab;
        if (tab && tab.xtermWrapper) {
          tab.xtermWrapper.focus();
        }
      }, 0);
    }
  }

  isScrolledToBottom() {
    // Legacy method - xterm.js handles its own scrolling
    return true;
  }

  scrollToBottom() {
    // Legacy method - xterm.js handles its own scrolling
  }

  // 快捷命令相关方法
  loadShortcuts() {
    try {
      const saved = localStorage.getItem('terminalShortcuts');
      return saved ? JSON.parse(saved) : [...this.defaultShortcuts];
    } catch (e) {
      console.error('Failed to load shortcuts, using defaults:', e);
      return [...this.defaultShortcuts];
    }
  }

  saveShortcuts() {
    localStorage.setItem('terminalShortcuts', JSON.stringify(this.shortcuts));
  }

  renderShortcuts() {
    const shortcutBar = document.getElementById('shortcutBar');
    const existingBtns = shortcutBar.querySelectorAll('.shortcut-btn');
    existingBtns.forEach(btn => btn.remove());

    this.shortcuts.forEach((shortcut, index) => {
      const btn = document.createElement('button');
      btn.className = 'shortcut-btn';
      btn.textContent = shortcut.label;
      btn.draggable = true;
      btn.setAttribute('data-command', shortcut.command);
      btn.setAttribute('data-alias', shortcut.alias);
      btn.setAttribute('data-index', index);
      const displayCommand = shortcut.command.includes('\n') ? '[Multi-line command]' : shortcut.command;
      btn.setAttribute('title', `${displayCommand}\n(Right-click for options)`);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.executeMultiLineCommand(shortcut.command);
      });

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showContextMenu(e, index);
      });

      // 拖拽事件
      btn.addEventListener('dragstart', (e) => this.handleDragStart(e, index));
      btn.addEventListener('dragend', (e) => this.handleDragEnd(e));
      btn.addEventListener('dragover', (e) => this.handleDragOver(e));
      btn.addEventListener('drop', (e) => this.handleDrop(e, index));

      shortcutBar.insertBefore(btn, document.getElementById('addShortcutBtn'));
    });
  }

  initShortcutBar() {
    console.log('[initShortcutBar] Setting up shortcut bar...');
    const shortcutBar = document.getElementById('shortcutBar');
    const toggleBtn = document.getElementById('toggleShortcutBtn');
    const addBtn = document.getElementById('addShortcutBtn');
    const modal = document.getElementById('addShortcutModal');
    const closeModal = document.getElementById('closeShortcutModal');
    const cancelBtn = document.getElementById('cancelBtn');
    const confirmBtn = document.getElementById('confirmBtn');
    const labelInput = document.getElementById('shortcutLabel');
    const commandInput = document.getElementById('shortcutCommand');
    const modalTitle = document.getElementById('addShortcutModalTitle');
    const contextMenu = document.getElementById('shortcutContextMenu');
    const editBtn = document.getElementById('editShortcutBtn');
    const deleteBtn = document.getElementById('deleteShortcutBtn');

    console.log('[initShortcutBar] toggleBtn:', toggleBtn);
    console.log('[initShortcutBar] shortcutBar:', shortcutBar);

    // 渲染快捷命令
    this.renderShortcuts();

    // 从 localStorage 加载显示状态
    const shortcutVisible = localStorage.getItem('shortcutVisible') === 'true';
    if (shortcutVisible) {
      shortcutBar.classList.add('visible');
      toggleBtn.classList.add('active');
    }

    // 切换快捷命令栏显示/隐藏
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        console.log('[toggleShortcutBtn] Clicked!');
        shortcutBar.classList.toggle('visible');
        toggleBtn.classList.toggle('active');
        localStorage.setItem('shortcutVisible', shortcutBar.classList.contains('visible'));
      });
    } else {
      console.error('[initShortcutBar] toggleBtn not found!');
    }

    // 打开新增快捷命令模态框
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openAddShortcutModal();
    });

    editBtn.addEventListener('click', () => {
      if (this.contextMenuTargetIndex !== null) {
        this.editShortcut(this.contextMenuTargetIndex);
        this.hideContextMenu();
      }
    });

    deleteBtn.addEventListener('click', () => {
      if (this.contextMenuTargetIndex !== null) {
        this.deleteShortcut(this.contextMenuTargetIndex);
        this.hideContextMenu();
      }
    });

    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) {
        this.hideContextMenu();
      }
    });

    const closeModalFn = () => {
      modal.classList.remove('visible');
      this.editingShortcutIndex = null;
    };

    closeModal.addEventListener('click', closeModalFn);
    cancelBtn.addEventListener('click', closeModalFn);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModalFn();
    });

    confirmBtn.addEventListener('click', () => {
      this.saveEditedShortcut();
    });

    commandInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        confirmBtn.click();
      }
    });

    commandInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModalFn();
      }
    });
  }

  openAddShortcutModal() {
    const modal = document.getElementById('addShortcutModal');
    const modalTitle = document.getElementById('addShortcutModalTitle');
    const labelInput = document.getElementById('shortcutLabel');
    const commandInput = document.getElementById('shortcutCommand');
    const confirmBtn = document.getElementById('confirmBtn');

    modalTitle.textContent = 'Add New Shortcut';
    labelInput.value = '';
    commandInput.value = '';
    confirmBtn.textContent = 'Add';

    modal.classList.add('visible');
    labelInput.focus();
  }

  deleteShortcut(index) {
    if (confirm('Delete this shortcut?')) {
      this.shortcuts.splice(index, 1);
      this.saveShortcuts();
      this.renderShortcuts();
    }
  }

  showContextMenu(e, index) {
    const contextMenu = document.getElementById('shortcutContextMenu');
    const menuWidth = 160;
    const menuHeight = 80;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > windowWidth) {
      x = windowWidth - menuWidth - 5;
    }

    if (y + menuHeight > windowHeight) {
      y = windowHeight - menuHeight - 5;
    }

    contextMenu.style.top = `${y}px`;
    contextMenu.style.left = `${x}px`;
    contextMenu.classList.add('visible');
    this.contextMenuTargetIndex = index;
  }

  hideContextMenu() {
    const contextMenu = document.getElementById('shortcutContextMenu');
    contextMenu.classList.remove('visible');
    this.contextMenuTargetIndex = null;
  }

  editShortcut(index) {
    const shortcut = this.shortcuts[index];
    if (!shortcut) return;

    this.editingShortcutIndex = index;

    const modal = document.getElementById('addShortcutModal');
    const modalTitle = document.getElementById('addShortcutModalTitle');
    const labelInput = document.getElementById('shortcutLabel');
    const commandInput = document.getElementById('shortcutCommand');
    const confirmBtn = document.getElementById('confirmBtn');

    modalTitle.textContent = 'Edit Shortcut';
    labelInput.value = shortcut.label;
    commandInput.value = shortcut.command;
    confirmBtn.textContent = 'Save';

    modal.classList.add('visible');
    labelInput.focus();
  }

  saveEditedShortcut() {
    const labelInput = document.getElementById('shortcutLabel');
    const commandInput = document.getElementById('shortcutCommand');
    const label = labelInput.value.trim();
    const command = commandInput.value.trim();

    if (!label || !command) {
      alert('Please fill in both fields');
      return;
    }

    if (this.editingShortcutIndex !== null) {
      this.shortcuts[this.editingShortcutIndex] = {
        label,
        command,
        alias: label.toLowerCase().replace(/\s+/g, '')
      };
      this.editingShortcutIndex = null;
    } else {
      this.shortcuts.push({
        label,
        command,
        alias: label.toLowerCase().replace(/\s+/g, '')
      });
    }

    this.saveShortcuts();
    this.renderShortcuts();

    const modal = document.getElementById('addShortcutModal');
    modal.classList.remove('visible');
  }


  handleDragStart(e, index) {
    this.draggedShortcut = index;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }

  handleDragEnd(e) {
    e.target.classList.remove('dragging');
    const allBtns = document.querySelectorAll('.shortcut-btn');
    allBtns.forEach(btn => {
      btn.classList.remove('drag-over');
    });
    this.draggedShortcut = null;
  }

  handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('.shortcut-btn');
    if (target && target !== e.target.querySelector('.dragging')) {
      target.classList.add('drag-over');
    }
  }

  handleDrop(e, targetIndex) {
    e.preventDefault();
    e.stopPropagation();

    if (this.draggedShortcut === null || this.draggedShortcut === targetIndex) {
      return;
    }

    const draggedItem = this.shortcuts[this.draggedShortcut];
    this.shortcuts.splice(this.draggedShortcut, 1);
    this.shortcuts.splice(targetIndex, 0, draggedItem);

    this.saveShortcuts();
    this.renderShortcuts();
  }

  initFontSizeControls() {
    this.applyFontSize();
  }

  openConnectionModal() {
    const modal = document.getElementById('newConnectionModal');
    const connectionType = document.getElementById('connectionType');
    const sshFields = document.getElementById('sshFields');
    const telnetFields = document.getElementById('telnetFields');
    const sessionName = document.getElementById('sessionName');
    const sshHost = document.getElementById('sshHost');

    // Reset form fields
    connectionType.value = 'local';
    sshFields.style.display = 'block';
    telnetFields.style.display = 'none';
    sshHost.value = '';
    document.getElementById('sshPort').value = '22';
    document.getElementById('sshUser').value = '';
    document.getElementById('sshPassword').value = '';
    document.getElementById('sshKeyPath').value = '';
    document.getElementById('telnetHost').value = '';
    document.getElementById('telnetPort').value = '23';
    sessionName.value = '';

    const updateSessionName = () => {
      const hostValue = sshHost.value.trim();
      if (!sessionName.value && hostValue) {
        sessionName.value = hostValue;
      }
    };

    sshHost.addEventListener('blur', updateSessionName);

    modal.classList.add('visible');
    sshHost.focus();
  }

  initConnectionModal() {
    const modal = document.getElementById('newConnectionModal');
    const closeBtn = document.getElementById('closeConnectionModal');
    const saveBtn = document.getElementById('connectBtn');
    const connectionType = document.getElementById('connectionType');
    const sshFields = document.getElementById('sshFields');
    const telnetFields = document.getElementById('telnetFields');

    connectionType.addEventListener('change', () => {
      const type = connectionType.value;
      if (type === 'local') {
        sshFields.style.display = 'none';
        telnetFields.style.display = 'none';
      } else if (type === 'ssh') {
        sshFields.style.display = 'block';
        telnetFields.style.display = 'none';
      } else if (type === 'telnet') {
        sshFields.style.display = 'none';
        telnetFields.style.display = 'block';
      }
    });

    const closeModalFn = () => {
      modal.classList.remove('visible');
    };

    closeBtn.addEventListener('click', closeModalFn);
    saveBtn.addEventListener('click', () => this.handleSaveSession());
  }

  async handleSaveSession() {
    const modal = document.getElementById('newConnectionModal');
    const connectionType = document.getElementById('connectionType').value;
    const sessionName = document.getElementById('sessionName').value.trim();

    if (!sessionName) {
      alert('Please enter a session name');
      return;
    }

    let connectionParams = null;
    let tabTitle = sessionName;
    const saveBtn = document.getElementById('connectBtn');
    const originalBtnText = saveBtn.textContent;

    try {
      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;

      if (connectionType === 'ssh') {
        const host = document.getElementById('sshHost').value.trim();
        const port = parseInt(document.getElementById('sshPort').value, 10);
        const user = document.getElementById('sshUser').value.trim();
        const password = document.getElementById('sshPassword').value;
        const keyPath = document.getElementById('sshKeyPath').value.trim();

        if (!host || !user) {
          alert('Please fill in host and username for SSH connection');
          return;
        }

        if (!password && !keyPath) {
          alert('Please enter either SSH password or private key path');
          return;
        }

        connectionParams = { host, port, user, password, keyPath };
        if (!tabTitle) tabTitle = `SSH: ${host}`;

      } else if (connectionType === 'telnet') {
        const host = document.getElementById('telnetHost').value.trim();
        const port = parseInt(document.getElementById('telnetPort').value, 10);

        if (!host) {
          alert('Please fill in host for Telnet connection');
          return;
        }

        connectionParams = { host, port };
        if (!tabTitle) tabTitle = `Telnet: ${host}`;
      } else if (connectionType === 'local') {
        if (!tabTitle) tabTitle = 'Local Shell';
      }

      const newSession = {
        id: Date.now(),
        name: sessionName,
        title: tabTitle,
        connectionType,
        connectionParams,
        content: [],
        commandHistory: [],
        savedAt: new Date().toISOString()
      };
      this.savedSessions.push(newSession);
      this.saveSessions();
      this.renderSessions();

      modal.classList.remove('visible');

    } catch (error) {
      console.error('[handleSaveSession] Error saving session:', error);
      alert(`Error saving session: ${error.message || 'Unknown error'}`);
    } finally {
      saveBtn.textContent = originalBtnText;
      saveBtn.disabled = false;
    }
  }

  formatPrompt(input) {
    const tab = this.activeTab;
    if (!tab) return '❯';

    if (tab.connectionType === 'ssh') {
      return `${tab.connectionParams?.user || 'user'}@${tab.connectionParams?.host || 'host'}>`;
    } else if (tab.connectionType === 'telnet') {
      return `telnet:${tab.connectionParams?.host || 'host'}>`;
    }

    let isWindows = false;
    if (typeof process !== 'undefined' && process.platform === 'win32') {
      isWindows = true;
    } else if (typeof window !== 'undefined' && window?.navigator?.platform) {
      isWindows = window.navigator.platform.includes('Win');
    }

    if (typeof input !== 'string') {
      return '❯';
    }

    if (input === '~') {
      return isWindows ? '~>' : '~/>';
    }

    const maxLen = isWindows ? 25 : 30;
    if (input.length <= maxLen) {
      return `${input}>`;
    }
    return `...${input.slice(-maxLen + 3)}>`;
  }

  getDynamicPromptText() {
    // Legacy method - PTY handles prompts
    return '❯>';
  }


  handleKeyDown(e) {
    // Legacy method no longer needed - xterm.js handles key events directly
  }

  navigateHistory(direction) {
    // Legacy method no longer needed - PTY history handled by shell
  }

  clearInput() {
    // Legacy method no longer needed - xterm.js handles input
  }

  async executeCommand() {
    // Legacy method no longer needed - PTY handles command execution
  }

  async executeMultiLineCommand(command) {
    const tab = this.activeTab;
    if (tab && tab.sessionId) {
      const lines = command.split('\n').map(line => line.trim());
      for (const line of lines) {
        if (line) {
          window.electronAPI.ptyWrite(tab.sessionId, line + '\r');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      if (tab.xtermWrapper) {
        tab.xtermWrapper.focus();
      }
    }
  }

  appendLineToTerminal(text, className = '') {
    // Legacy method no longer needed - xterm.js handles terminal output
  }

  appendOutput(output, className = '') {
    // Legacy method no longer needed - xterm.js handles output via PTY data
  }

  clearTerminal() {
    // Legacy method no longer needed - xterm.js Terminal.clear() used instead
  }

  showHelp() {
    // Legacy method no longer needed - shell has 'help' command
  }

  showHistory() {
    // Legacy method no longer needed - shell has 'history' command
  }

  loadGlobalCommandHistory() {
    try {
      const saved = localStorage.getItem('globalCommandHistory');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  }

  saveGlobalCommandHistory() {
    localStorage.setItem('globalCommandHistory', JSON.stringify(this.globalCommandHistory));
  }

  addToGlobalHistory(command) {
    if (!command || command.trim() === '') return;

    const trimmedCommand = command.trim();

    if (this.globalCommandHistory.length > 0 &&
        this.globalCommandHistory[0].command === trimmedCommand) {
      return;
    }

    this.globalCommandHistory.unshift({
      command: trimmedCommand,
      timestamp: Date.now()
    });

    if (this.globalCommandHistory.length > this.maxHistorySize) {
      this.globalCommandHistory = this.globalCommandHistory.slice(0, this.maxHistorySize);
    }

    this.saveGlobalCommandHistory();
    this.renderHistoryList();
  }

  initHistorySidebar() {
    const toggleBtn = document.getElementById('toggleHistoryBtn');
    const historySidebar = document.getElementById('historySidebar');
    const clearBtn = document.getElementById('clearHistoryBtn');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        historySidebar.classList.toggle('visible');
        toggleBtn.classList.toggle('active');
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Clear all command history?')) {
          this.globalCommandHistory = [];
          this.saveGlobalCommandHistory();
          this.renderHistoryList();
        }
      });
    }

    this.renderHistoryList();
  }

  renderHistoryList() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    historyList.innerHTML = '';

    if (this.globalCommandHistory.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'No command history';
      empty.style.color = '#6a6a6a';
      empty.style.textAlign = 'center';
      empty.style.padding = '20px';
      empty.style.fontSize = '12px';
      historyList.appendChild(empty);
      return;
    }

    this.globalCommandHistory.forEach((item, index) => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';

      const time = new Date(item.timestamp);
      const timeStr = time.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      historyItem.innerHTML = `
        <span class="history-item-index">${index + 1}</span>
        <div class="history-item-content">
          <div class="history-item-command">${item.command}</div>
          <div class="history-item-time">${timeStr}</div>
        </div>
        <div class="history-item-actions">
          <button class="history-item-action" title="Output to terminal">💻</button>
          <button class="history-item-action" title="Copy to clipboard">📋</button>
          <button class="history-item-action delete" title="Delete">🗑️</button>
        </div>
      `;

      historyItem.addEventListener('click', () => {
        this.fillCommandFromHistory(item.command);
      });

      historyItem.addEventListener('dblclick', () => {
        this.executeCommandFromHistory(item.command);
      });

      const outputBtn = historyItem.querySelector('.history-item-action:first-of-type');
      outputBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.outputCommandToTerminal(item.command);
      });

      const copyBtn = historyItem.querySelectorAll('.history-item-action')[1];
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(item.command);
        copyBtn.textContent = '✓';
        setTimeout(() => copyBtn.textContent = '📋', 1000);
      });

      const deleteBtn = historyItem.querySelector('.history-item-action.delete');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.globalCommandHistory.splice(index, 1);
        this.saveGlobalCommandHistory();
        this.renderHistoryList();
      });

      historyList.appendChild(historyItem);
    });
  }

  executeCommandFromHistory(command) {
    const tab = this.activeTab;
    if (tab && tab.sessionId) {
      window.electronAPI.ptyWrite(tab.sessionId, command + '\r');
      if (tab.xtermWrapper) {
        tab.xtermWrapper.focus();
      }
    }
  }

  fillCommandFromHistory(command) {
    this.executeCommandFromHistory(command);
  }

  outputCommandToTerminal(command) {
    this.executeCommandFromHistory(command);
  }

  initSessionSidebar() {
    console.log('[initSessionSidebar] Setting up session sidebar...');
    const addSessionBtn = document.getElementById('addSessionBtn');

    console.log('[initSessionSidebar] addSessionBtn:', addSessionBtn);

    // 侧边栏添加按钮 - 打开新建连接对话框保存会话
    if (addSessionBtn) {
      addSessionBtn.addEventListener('click', () => {
        console.log('[addSessionBtn] Clicked!');
        this.openConnectionModal();
      });
    } else {
      console.error('[initSessionSidebar] addSessionBtn not found!');
    }

    // 加载已保存的会话
    this.loadSessions();
    console.log('[initSessionSidebar] Setup complete!');
  }

  loadSessions() {
    try {
      const saved = localStorage.getItem('savedSessions');
      this.savedSessions = saved ? JSON.parse(saved) : [];
      this.renderSessions();
    } catch (e) {
      console.error('[loadSessions] Failed to load sessions, using empty list:', e);
      this.savedSessions = [];
      this.renderSessions();
    }
  }

  saveSessions() {
    localStorage.setItem('savedSessions', JSON.stringify(this.savedSessions));
  }

  renderSessions() {
    const sessionList = document.getElementById('sessionList');
    sessionList.innerHTML = '';

    this.savedSessions.forEach((session, index) => {
      const item = document.createElement('div');
      item.className = `session-item ${this.isSessionActive(session) ? 'active' : ''}`;
      item.setAttribute('draggable', 'true');
      item.setAttribute('data-index', index);

      const connectionTypeIcon = this.getConnectionTypeIcon(session.connectionType);

      item.innerHTML = `
        <span class="session-item-icon">${connectionTypeIcon}</span>
        <div class="session-item-info">
          <div class="session-item-name">${session.name}</div>
          <div class="session-item-type">
            <span class="session-item-type-dot"></span>
            ${session.connectionType.toUpperCase()} • ${session.title}
          </div>
        </div>
        <div class="session-item-actions">
          <button class="session-item-action load" title="Load session">↗</button>
          <button class="session-item-action delete" title="Delete session">×</button>
        </div>
      `;

      item.addEventListener('click', () => {
        this.openSessionInNewTab(session);
      });

      const deleteBtn = item.querySelector('.delete');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete session "${session.name}"?`)) {
          this.deleteSession(index);
        }
      });

      item.addEventListener('dragstart', (e) => {
        this.draggedSessionIndex = index;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        this.clearDragOver();
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (index === this.draggedSessionIndex) return;
        e.dataTransfer.dropEffect = 'move';
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (index === this.draggedSessionIndex) return;
        this.reorderSessions(this.draggedSessionIndex, index);
      });

      sessionList.appendChild(item);
    });
  }

  isSessionActive(session) {
    const tab = this.activeTab;
    if (!tab) return false;
    
    return tab.id === session.tabId &&
           tab.connectionType === session.connectionType;
  }

  getConnectionTypeIcon(connectionType) {
    switch(connectionType) {
      case 'local': return '💻';
      case 'ssh': return '🔐';
      case 'telnet': return '🌐';
      default: return '📡';
    }
  }

  saveSession(name) {
    const tab = this.activeTab;
    if (!tab) return;

    const session = {
      id: Date.now(),
      name,
      title: tab.title,
      connectionType: tab.connectionType,
      connectionParams: tab.connectionParams,
      tabId: tab.id,
      content: tab.content,
      commandHistory: tab.commandHistory,
      savedAt: new Date().toISOString()
    };

    this.savedSessions.push(session);
    this.saveSessions();
    this.renderSessions();
    
    // 标记当前tab已保存
    tab.savedSessionId = session.id;
    this.renderSessions();
  }

  loadSessionToTab(session) {
    const tab = new Tab(
      session.tabId || this.nextTabId++,
      session.title,
      session.connectionType,
      session.connectionParams
    );

    if (session.tabId && session.tabId >= this.nextTabId) {
      this.nextTabId = session.tabId + 1;
    }

    if (session.content) {
      tab.content = session.content;
    }

    tab.commandHistory = session.commandHistory || [];
    tab.savedSessionId = session.id;

    // 如果是新tabId，添加tabs集合
    if (!this.tabs.find(t => t.id === tab.id)) {
      this.tabs.push(tab);
    }

    this.activeTabId = tab.id;
    this.renderTabs();
    this.loadActiveTab();
    this.renderSessions();
    this.saveState();
  }

  openSessionInNewTab(session) {
    console.log('[openSessionInNewTab] Opening session in new tab:', session.name);
    const tab = this.createTab(session.title, session.connectionType, session.connectionParams);
    tab.savedSessionId = session.id;
    this.renderSessions();
    console.log('[openSessionInNewTab] New tab created:', tab.id, 'for session:', session.name);
  }

  deleteSession(index) {
    this.savedSessions.splice(index, 1);
    this.saveSessions();
    
    // 清除tab的savedSessionId引用
    this.tabs.forEach(tab => {
      if (tab.savedSessionId === this.savedSessions[index]?.id) {
        tab.savedSessionId = null;
      }
    });
    
    this.renderSessions();
  }

  reorderSessions(fromIndex, toIndex) {
    const item = this.savedSessions.splice(fromIndex, 1)[0];
    this.savedSessions.splice(toIndex, 0, item);
    this.saveSessions();
    this.renderSessions();
  }

  clearDragOver() {
    const items = document.querySelectorAll('.session-item');
    items.forEach(item => {
      item.classList.remove('drag-over-top');
      item.classList.remove('drag-over-bottom');
    });
  }
}

// 保留LazyTerminal类以兼容性，但现在只是TabManager的别名
class LazyTerminal extends TabManager {
}

const initApp = () => {
  console.log('[Init] App starting...');
  console.log('[Init] Checking button elements exist:');
  console.log('[Init] - toggleShortcutBtn:', document.getElementById('toggleShortcutBtn'));
  console.log('[Init] - addSessionBtn:', document.getElementById('addSessionBtn'));
  console.log('[Init] - newTabBtn:', document.getElementById('newTabBtn'));
  console.log('[Init] Checking modal states:');
  console.log('[Init] - addShortcutModal:', document.getElementById('addShortcutModal'));
  console.log('[Init] - newConnectionModal:', document.getElementById('newConnectionModal'));
  console.log('[Init] - saveSessionModal:', document.getElementById('saveSessionModal'));

  const modals = ['addShortcutModal', 'newConnectionModal', 'saveSessionModal'];
  modals.forEach(id => {
    const modal = document.getElementById(id);
    if (modal && modal.classList.contains('visible')) {
      console.error(`[Init] Modal ${id} is VISIBLE! This may block clicks!`);
    }
  });

  new TabManager();
  console.log('[Init] TabManager created!');
};

if (document.readyState === 'loading') {
  console.log('[Init] DOM still loading, waiting for DOMContentLoaded...');
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  console.log('[Init] DOM already loaded, initializing immediately');
  initApp();
}
