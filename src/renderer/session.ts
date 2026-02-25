import { Logger } from './logger';
import { SessionType, SessionConfig, SessionFactory } from '../types/types';

export class SessionUI {
  // DOM 元素引用
  private readonly sessionList = document.getElementById('sessionList');
  private readonly addSessionBtn = document.getElementById('addSessionBtn');
  private readonly modal = document.getElementById('newConnectionModal');
  private readonly typeSelect = document.getElementById('connectionType') as HTMLSelectElement;
  private readonly saveBtn = document.getElementById('saveSessionBtn');
  private readonly closeBtn = document.getElementById('closeConnectionModal');

  private savedSessions: SessionConfig[] = [];
  private draggedSessionIndex: number | null = null;

  // 静态图标配置
  private static readonly ICONS: Record<string, string> = {
    local: '💻',
    ssh: '🔐',
    telnet: '🌐',
    'git-bash': '🦊',
    default: '📡'
  };

  constructor() {
    // 绑定 this 指向
    this.handleSessionClick = this.handleSessionClick.bind(this);
  }

  /**
   * 初始化入口
   */
  public init(): void {
    this.loadSessions();
    this.initEventListeners();
    this.renderSessions();
    Logger.debug('SessionUI', 'Bookmarks Initialized');
  }

  private initEventListeners(): void {
    // 1. 模态框控制
    this.addSessionBtn?.addEventListener('click', () => this.toggleModal(true));
    this.closeBtn?.addEventListener('click', () => this.toggleModal(false));
    
    // 2. 表单类型切换
    this.typeSelect?.addEventListener('change', () => {
      this.toggleFieldsDisplay(this.typeSelect.value as SessionType);
    });

    // 3. 保存逻辑
    this.saveBtn?.addEventListener('click', () => this.handleSaveSession());

    // 4. 列表点击事件委托 (删除和连接)
    this.sessionList?.addEventListener('click', this.handleSessionClick);

    // 5. 拖拽排序逻辑
    this.initDragAndDrop();
  }

  /**
   * 处理列表内的点击：识别删除按钮或条目点击
   */
  private handleSessionClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const item = target.closest('.session-item') as HTMLElement;
    if (!item) return;

    const index = parseInt(item.dataset.index || '0');
    const session = this.savedSessions[index];

    if (target.closest('.delete')) {
      e.stopPropagation();
      this.confirmDelete(index);
    } else {
      // 触发应用开启新标签页（不涉及 SessionUI 内部状态改变）
      (window.app as any)?.createTabFromSession?.(session);
    }
  }

  /**
   * 渲染书签列表
   */
  public renderSessions(): void {
    if (!this.sessionList) return;

    const fragment = document.createDocumentFragment();

    this.savedSessions.forEach((session, index) => {
      const item = document.createElement('div');
      item.className = 'session-item';
      item.draggable = true;
      item.dataset.index = index.toString();
      
      const icon = SessionUI.ICONS[session.type] || SessionUI.ICONS.default;
      const subTitle = this.getDisplaySubtitle(session);

      item.innerHTML = `
        <span class="session-item-icon">${icon}</span>
        <div class="session-item-info">
          <div class="session-item-name">${this.escapeHtml(session.params.name)}</div>
          <div class="session-item-type">
            ${session.type.toUpperCase()} • ${this.escapeHtml(subTitle)}
          </div>
        </div>
        <div class="session-item-actions">
          <button class="session-item-action delete" title="Delete Bookmark">×</button>
        </div>
      `;
      fragment.appendChild(item);
    });

    this.sessionList.innerHTML = '';
    this.sessionList.appendChild(fragment);
  }

  /**
   * 保存书签
   */
  private async handleSaveSession(): Promise<void> {
    const type = this.typeSelect.value as SessionType;
    const nameInput = document.getElementById('sessionName') as HTMLInputElement;
    const name = nameInput.value.trim();

    if (!name) return alert('Please enter a session name');

    // 提取表单中所有带有 data-param-key 的数据
    const params = this.getParamsFromForm(type);

    const newSession = SessionFactory.createConfig(params)

    this.savedSessions.push(newSession);
    this.saveToStorage();
    this.renderSessions();
    this.toggleModal(false);
  }

  /**
   * 根据当前类型从 HTML 获取参数
   */
  private getParamsFromForm(type: SessionType): any {
    const params: any = { type };
    // 这里的选择器假设你在 HTML 中使用了类似 class="ssh-field" 且有 data-param-key
    const fields = document.querySelectorAll(`.${type}-field`) as NodeListOf<HTMLInputElement>;
    
    fields.forEach(input => {
      const key = input.dataset.paramKey;
      if (!key) return;

      let value: any = input.value.trim();
      if (input.type === 'number' || key === 'port') {
        value = parseInt(value, 10) || 0;
      }
      params[key] = value;
    });

    return params;
  }

  private toggleFieldsDisplay(type: SessionType): void {
    const sections = ['local', 'ssh', 'telnet'];
    sections.forEach(s => {
      const el = document.getElementById(`${s}Fields`);
      if (el) el.style.display = (s === type) ? 'block' : 'none';
    });
  }

  private getDisplaySubtitle(session: SessionConfig): string {
    const p = session.params;
    if (session.type === 'local') return 'Local Terminal';
    const name = p.name || 'unknown';
    return name;
  }

  private toggleModal(visible: boolean): void {
    if (!this.modal) return;
    if (visible) {
      this.modal.classList.add('visible');
      this.resetForm();
    } else {
      this.modal.classList.remove('visible');
    }
  }

  private resetForm(): void {
    const inputs = this.modal?.querySelectorAll('input');
    inputs?.forEach(input => input.value = '');
    // 恢复默认端口
    const sshPort = document.querySelector('[data-param-key="sshPort"]') as HTMLInputElement;
    if (sshPort) sshPort.value = '22';
  }

  // --- 持久化与辅助 ---

  private loadSessions(): void {
    const raw = localStorage.getItem('saved_session_bookmarks');
    this.savedSessions = raw ? JSON.parse(raw) : [];
  }

  private saveToStorage(): void {
    localStorage.setItem('saved_session_bookmarks', JSON.stringify(this.savedSessions));
  }

  private confirmDelete(index: number): void {
    if (confirm(`Delete bookmark "${this.savedSessions[index].params.name}"?`)) {
      this.savedSessions.splice(index, 1);
      this.saveToStorage();
      this.renderSessions();
    }
  }

  private initDragAndDrop(): void {
    this.sessionList?.addEventListener('dragstart', (e) => {
      const target = (e.target as HTMLElement).closest('.session-item') as HTMLElement;
      if (!target) return;
      this.draggedSessionIndex = parseInt(target.dataset.index || '0');
      target.classList.add('dragging');
    });

    this.sessionList?.addEventListener('dragover', (e) => e.preventDefault());
    
    this.sessionList?.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = (e.target as HTMLElement).closest('.session-item') as HTMLElement;
      if (!target || this.draggedSessionIndex === null) return;
      
      const dropIndex = parseInt(target.dataset.index || '0');
      if (this.draggedSessionIndex !== dropIndex) {
        const [movedItem] = this.savedSessions.splice(this.draggedSessionIndex, 1);
        this.savedSessions.splice(dropIndex, 0, movedItem);
        this.saveToStorage();
        this.renderSessions();
      }
    });

    this.sessionList?.addEventListener('dragend', (e) => {
      (e.target as HTMLElement).classList.remove('dragging');
    });
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}