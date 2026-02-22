import { Logger } from './logger';

export interface HistoryItem {
  command: string;
  timestamp: number;
}

export class HistoryUI {
  // 缓存 DOM 引用
  private readonly elements = {
    list: document.getElementById('historyList'),
    sidebar: document.getElementById('historySidebar'),
    clearBtn: document.getElementById('clearHistoryBtn'),
    toggleBtn: document.getElementById('toggleHistoryBtn'),
  };

  private history: HistoryItem[] = [];
  private readonly MAX_HISTORY_SIZE = 200;
  private readonly STORAGE_KEY = 'globalCommandHistory';

  constructor() {
    // 绑定 this，确保在事件回调中指向正确
    this.handleListClick = this.handleListClick.bind(this);
  }

  init(): void {
    this.loadHistory();
    this.initListeners();
    this.render();
    Logger.debug('HistoryUI', 'Initialized');
  }

  private initListeners(): void {
    const { clearBtn, toggleBtn, list } = this.elements;

    clearBtn?.addEventListener('click', () => {
      if (confirm('确定要清空所有命令历史吗？')) {
        this.clearHistory();
      }
    });

    toggleBtn?.addEventListener('click', () => this.toggle());

    // 使用事件委托：只在父容器上绑定一个监听器
    list?.addEventListener('click', this.handleListClick);
  }

  /**
   * 事件委托处理函数
   */
  private handleListClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const itemEl = target.closest('.history-item') as HTMLElement;
    if (!itemEl) return;

    const index = parseInt(itemEl.dataset.index || '0');
    const item = this.history[index];
    if (!item) return;

    // 识别具体动作
    const actionBtn = target.closest('.history-item-action');
    
    if (actionBtn?.classList.contains('delete')) {
      e.stopPropagation();
      this.deleteItem(index);
    } else if (actionBtn?.classList.contains('copy')) {
      e.stopPropagation();
      this.copyToClipboard(item.command, actionBtn as HTMLElement);
    } else {
      // 默认：点击整行或点击终端图标 -> 执行命令
      this.executeCommand(item.command);
    }
  }

  // --- 数据操作 ---

  loadHistory(): void {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      this.history = saved ? JSON.parse(saved) : [];
    } catch (e) {
      Logger.error('HistoryUI', 'Failed to load history', e);
      this.history = [];
    }
  }

  private saveHistory(): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.history));
  }

  addCommand(command: string): void {
    const trimmed = command?.trim();
    if (!trimmed) return;

    // 优化：如果新命令与最后一条命令相同，则不重复记录
    if (this.history.length > 0 && this.history[0].command === trimmed) return;

    this.history.unshift({ command: trimmed, timestamp: Date.now() });

    if (this.history.length > this.MAX_HISTORY_SIZE) {
      this.history = this.history.slice(0, this.MAX_HISTORY_SIZE);
    }

    this.saveHistory();
    this.render();
  }

  private deleteItem(index: number): void {
    this.history.splice(index, 1);
    this.saveHistory();
    this.render();
  }

  clearHistory(): void {
    this.history = [];
    this.saveHistory();
    this.render();
  }

  // --- UI 逻辑 ---

  private render(): void {
    const { list } = this.elements;
    if (!list) return;

    if (this.history.length === 0) {
      list.innerHTML = `<div class="history-empty">暂无历史记录</div>`;
      return;
    }

    // 使用 DocumentFragment 减少重绘开销
    const fragment = document.createDocumentFragment();
    
    this.history.forEach((item, index) => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';
      historyItem.dataset.index = index.toString();
      
      const timeStr = new Date(item.timestamp).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });

      // 使用 textContent 防止 XSS，或者确保 command 经过处理
      historyItem.innerHTML = `
        <span class="history-item-index">${index + 1}</span>
        <div class="history-item-content">
          <div class="history-item-command" title="${this.escapeHtml(item.command)}">${this.escapeHtml(item.command)}</div>
          <div class="history-item-time">${timeStr}</div>
        </div>
        <div class="history-item-actions">
          <button class="history-item-action terminal" title="输出到终端">💻</button>
          <button class="history-item-action copy" title="复制到剪贴板">📋</button>
          <button class="history-item-action delete" title="删除">🗑️</button>
        </div>
      `;
      fragment.appendChild(historyItem);
    });

    list.innerHTML = '';
    list.appendChild(fragment);
  }

  private executeCommand(command: string): void {
    const activeTab = (window.app as any)?.activeTab;
    if (activeTab?.sessionId && window.electronAPI) {
      window.electronAPI.ptyWrite(activeTab.sessionId, command + '\r');
      activeTab.xtermWrapper?.focus();
    } else {
      Logger.warn('HistoryUI', 'No active terminal session');
    }
  }

  private async copyToClipboard(text: string, btn: HTMLElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      const originalIcon = btn.textContent;
      btn.textContent = '✓';
      btn.classList.add('success');
      setTimeout(() => {
        btn.textContent = originalIcon;
        btn.classList.remove('success');
      }, 1000);
    } catch (err) {
      Logger.error('HistoryUI', 'Copy failed', err);
    }
  }

  toggle(): void {
    const { sidebar, toggleBtn } = this.elements;
    const isVisible = sidebar?.classList.toggle('visible');
    toggleBtn?.classList.toggle('active', isVisible);
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}