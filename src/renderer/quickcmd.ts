import { Logger } from './logger';

export interface ShortcutCommand {
  label: string;
  command: string;
  alias: string;
}

export class QuickCmdUI {
  // DOM 元素引用
  private elements = {
    bar: null as HTMLElement | null,
    toggleBtn: null as HTMLElement | null,
    addBtn: null as HTMLElement | null,
    contextMenu: null as HTMLElement | null,
    modal: null as HTMLElement | null,
    modalTitle: null as HTMLElement | null,
    labelInput: null as HTMLInputElement | null,
    commandInput: null as HTMLTextAreaElement | null,
    confirmBtn: null as HTMLElement | null
  };

  private initElements(): void {
    this.elements = {
      bar: document.getElementById('shortcutBar'),
      toggleBtn: document.getElementById('toggleShortcutBtn'),
      addBtn: document.getElementById('addShortcutBtn'),
      contextMenu: document.getElementById('shortcutContextMenu'),
      modal: document.getElementById('addShortcutModal'),
      modalTitle: document.getElementById('addShortcutModalTitle'),
      labelInput: document.getElementById('shortcutLabel') as HTMLInputElement,
      commandInput: document.getElementById('shortcutCommand') as HTMLTextAreaElement,
      confirmBtn: document.getElementById('confirmBtn')
    };
  }

  private readonly DEFAULT_SHORTCUTS: ShortcutCommand[] = [
    { label: 'help', command: 'help', alias: 'help' },
    { label: 'clear', command: 'clear', alias: 'clear' },
    { label: 'history', command: 'history', alias: 'history' },
    { label: 'dir', command: 'dir', alias: 'dir' },
    { label: 'pwd', command: 'pwd', alias: 'pwd' },
    { label: 'echo', command: 'echo $USERPROFILE', alias: 'echo' },
  ];

  private shortcuts: ShortcutCommand[] = [];
  private draggedIndex: number | null = null;
  private contextIndex: number | null = null;
  private editingIndex: number | null = null;

  constructor() {
    this.handleGlobalClick = this.handleGlobalClick.bind(this);
  }

  init(): void {
    this.initElements();
    this.loadShortcuts();
    this.initEventListeners();
    this.renderShortcuts();
    this.restoreVisibility();
    Logger.debug('QuickCmdUI', 'Initialized');
  }

  private initEventListeners(): void {
    const { bar, toggleBtn, addBtn, confirmBtn, contextMenu } = this.elements;

    // 1. 顶部控制
    toggleBtn?.addEventListener('click', () => this.toggle());
    addBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openModal();
    });

    // 2. 事件委托：处理快捷键点击、右键和拖拽
    bar?.addEventListener('click', (e) => this.onBarClick(e));
    bar?.addEventListener('contextmenu', (e) => this.onBarContextMenu(e));
    
    // 3. 拖拽生命周期
    bar?.addEventListener('dragstart', (e) => this.onDragStart(e));
    bar?.addEventListener('dragover', (e) => this.onDragOver(e));
    bar?.addEventListener('drop', (e) => this.onDrop(e));
    bar?.addEventListener('dragend', (e) => this.onDragEnd(e));

    // 4. 右键菜单操作
    document.getElementById('editShortcutBtn')?.addEventListener('click', () => {
      if (this.contextIndex !== null) this.openModal(this.contextIndex);
      this.hideContextMenu();
    });

    document.getElementById('deleteShortcutBtn')?.addEventListener('click', () => {
      if (this.contextIndex !== null) this.deleteShortcut(this.contextIndex);
      this.hideContextMenu();
    });

    // 5. 模态框操作
    confirmBtn?.addEventListener('click', () => this.saveShortcut());
    document.getElementById('closeShortcutModal')?.addEventListener('click', () => this.closeModal());
    document.getElementById('cancelBtn')?.addEventListener('click', () => this.closeModal());
    
    // 全局点击关闭菜单
    document.addEventListener('click', this.handleGlobalClick);
  }

  // --- 核心逻辑 ---

  private onBarClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest('.shortcut-btn');
    if (!btn || btn.id === 'addShortcutBtn') return;

    const index = parseInt(btn.getAttribute('data-index') || '0');
    const shortcut = this.shortcuts[index];
    if (shortcut) this.executeCommand(shortcut.command);
  }

  private onBarContextMenu(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest('.shortcut-btn');
    if (!btn || btn.id === 'addShortcutBtn') return;

    e.preventDefault();
    const index = parseInt(btn.getAttribute('data-index') || '0');
    this.showContextMenu(e, index);
  }

  private async executeCommand(command: string): Promise<void> {
    const activeTab = (window.app as any)?.activeTab;
    const sessionId = activeTab?.sessionId;

    if (!sessionId || !window.electronAPI) {
      Logger.warn('QuickCmdUI', 'No active session to execute command');
      return;
    }

    const lines = command.split('\n').map(l => l.trim()).filter(l => l);
    
    for (const line of lines) {
      await window.electronAPI.ptyWrite(sessionId, line + '\r');
      // 给终端一点处理时间，防止多行命令粘连
      await new Promise(r => setTimeout(r, 50));
    }
    
    activeTab.xtermWrapper?.focus();
  }

  // --- UI 渲染 ---

  private renderShortcuts(): void {
    if (!this.elements.bar) return;

    // 清理旧按钮（保留 Add 按钮）
    const btns = this.elements.bar.querySelectorAll('.shortcut-btn:not(#addShortcutBtn)');
    btns.forEach(b => b.remove());

    const fragment = document.createDocumentFragment();
    this.shortcuts.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'shortcut-btn';
      btn.draggable = true;
      btn.dataset.index = i.toString();
      btn.textContent = s.label;
      
      const tooltip = s.command.length > 50 ? s.command.substring(0, 50) + '...' : s.command;
      btn.title = `${tooltip}\n(Right-click to edit)`;
      
      fragment.appendChild(btn);
    });

    this.elements.bar.insertBefore(fragment, this.elements.addBtn);
  }

  // --- 模态框与保存 ---

  private openModal(index: number | null = null): void {
    this.editingIndex = index;
    const { modal, modalTitle, labelInput, commandInput, confirmBtn } = this.elements;

    if (index !== null) {
      const s = this.shortcuts[index];
      if (modalTitle) modalTitle.textContent = 'Edit Shortcut';
      if (labelInput) labelInput.value = s.label;
      if (commandInput) commandInput.value = s.command;
      if (confirmBtn) confirmBtn.textContent = 'Save';
    } else {
      if (modalTitle) modalTitle.textContent = 'Add Shortcut';
      if (labelInput) labelInput.value = '';
      if (commandInput) commandInput.value = '';
      if (confirmBtn) confirmBtn.textContent = 'Add';
    }

    modal?.classList.add('visible');
    labelInput?.focus();
  }

  private saveShortcut(): void {
    const label = this.elements.labelInput.value.trim();
    const command = this.elements.commandInput.value.trim();

    if (!label || !command) return alert('Please fill in both fields');

    const newShortcut: ShortcutCommand = {
      label,
      command,
      alias: label.toLowerCase().replace(/\s+/g, '')
    };

    if (this.editingIndex !== null) {
      this.shortcuts[this.editingIndex] = newShortcut;
    } else {
      this.shortcuts.push(newShortcut);
    }

    this.saveAndRefresh();
    this.closeModal();
  }

  // --- 辅助功能 ---

  public toggle(): void {
    const isVisible = this.elements.bar?.classList.toggle('visible');
    this.elements.toggleBtn?.classList.toggle('active');
    
    // Toggle右侧内容区类 - 用于调整terminal-wrapper高度
    const rightContent = this.elements.bar?.closest('.right-content') as HTMLElement;
    if (rightContent) {
      if (isVisible) {
        rightContent.classList.add('shortcuts-visible');
      } else {
        rightContent.classList.remove('shortcuts-visible');
      }
    }
    
    localStorage.setItem('shortcutVisible', String(isVisible));
    
    // 触发xterm重新调整大小
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 250);
  }

  private showContextMenu(e: MouseEvent, index: number): void {
    const menu = this.elements.contextMenu;
    if (!menu) return;

    this.contextIndex = index;
    menu.style.display = 'block'; // 先显示以获取宽高
    
    const { clientX: x, clientY: y } = e;
    const { offsetWidth: w, offsetHeight: h } = menu;
    
    // 边界检测：防止菜单超出窗口
    const left = x + w > window.innerWidth ? x - w : x;
    const top = y + h > window.innerHeight ? y - h : y;

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.classList.add('visible');
  }

  private hideContextMenu(): void {
    this.elements.contextMenu?.classList.remove('visible');
    this.contextIndex = null;
  }

  private handleGlobalClick(e: MouseEvent): void {
    if (!this.elements.contextMenu?.contains(e.target as Node)) {
      this.hideContextMenu();
    }
  }

  // --- 拖拽排序 ---

  private onDragStart(e: DragEvent): void {
    const btn = (e.target as HTMLElement).closest('.shortcut-btn');
    if (!btn) return;
    this.draggedIndex = parseInt(btn.getAttribute('data-index') || '0');
    btn.classList.add('dragging');
  }

  private onDragOver(e: DragEvent): void {
    e.preventDefault();
    const btn = (e.target as HTMLElement).closest('.shortcut-btn');
    if (btn) btn.classList.add('drag-over');
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    const btn = (e.target as HTMLElement).closest('.shortcut-btn');
    if (!btn || this.draggedIndex === null) return;

    const targetIndex = parseInt(btn.getAttribute('data-index') || '0');
    if (this.draggedIndex !== targetIndex) {
      const [movedItem] = this.shortcuts.splice(this.draggedIndex, 1);
      this.shortcuts.splice(targetIndex, 0, movedItem);
      this.saveAndRefresh();
    }
  }

  private onDragEnd(e: DragEvent): void {
    this.elements.bar?.querySelectorAll('.shortcut-btn').forEach(b => {
      b.classList.remove('dragging', 'drag-over');
    });
    this.draggedIndex = null;
  }

  // --- 数据持久化 ---

  private saveAndRefresh(): void {
    localStorage.setItem('terminalShortcuts', JSON.stringify(this.shortcuts));
    this.renderShortcuts();
  }

  private loadShortcuts(): void {
    const saved = localStorage.getItem('terminalShortcuts');
    this.shortcuts = saved ? JSON.parse(saved) : [...this.DEFAULT_SHORTCUTS];
  }

  private restoreVisibility(): void {
    if (localStorage.getItem('shortcutVisible') === 'true') {
      this.elements.bar?.classList.add('visible');
      this.elements.toggleBtn?.classList.add('active');

      const rightContent = this.elements.bar?.closest('.right-content') as HTMLElement;
      if (rightContent) {
        rightContent.classList.add('shortcuts-visible');
      }
    }
  }

  private closeModal(): void {
    this.elements.modal?.classList.remove('visible');
    this.editingIndex = null;
  }

  private deleteShortcut(index: number): void {
    if (confirm('Delete this shortcut?')) {
      this.shortcuts.splice(index, 1);
      this.saveAndRefresh();
    }
  }
}