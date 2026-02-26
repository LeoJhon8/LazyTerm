// tabs.ts
export interface TabData {
  id: number;
  title: string;
  connectionType: 'local' | 'ssh' | 'telnet' | 'git-bash';
  connectionParams: any;
  isConnected: boolean;
  sessionId: string | null;
  xtermWrapper: any;
  container: HTMLElement | null;
  scrollTop?: number;
}

export interface TabsUIConfig {
  tabsWrapperId: string;
  newTabBtnId: string;
}

export class TabsUI {
  protected tabs: Map<number, TabData> = new Map();
  protected nextTabId = 1;
  protected activeTabId: number | null = null;
  protected readonly tabsWrapper: HTMLElement | null;
  protected readonly newTabBtn: HTMLElement | null;

  constructor(config: TabsUIConfig) {
    this.tabsWrapper = document.getElementById(config.tabsWrapperId);
    this.newTabBtn = document.getElementById(config.newTabBtnId);
  }

  /**
   * 框架初始化流程
   */
  public init(): void {
    this.initTabBaseEvents();
    this.initFontSizeControls();
    this.setupGlobalEventListeners();
    this.bindSubModuleEvents();
    this.mountGlobalAPI();
    this.render();
  }

  // --- 生命周期钩子 (子类可覆写) ---

  protected initFontSizeControls(): void {
    // 基础实现：监听 Ctrl + 滚轮
    document.getElementById('terminalWrapper')?.addEventListener('wheel', (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 2 : -2;
        (this as any).changeFontSize?.(delta);
      }
    }, { passive: false });
  }

  protected loadFontSize(): number {
    const saved = localStorage.getItem('terminalFontSize');
    return saved ? parseInt(saved, 10) : 14;
  }

  protected setupGlobalEventListeners(): void { /* 子类实现 */ }
  protected bindSubModuleEvents(): void { /* 子类实现 */ }
  protected mountGlobalAPI(): void { /* 子类实现 */ }

  // --- Tab 核心逻辑 ---

  private initTabBaseEvents(): void {

    this.tabsWrapper?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const tabEl = target.closest('.tab') as HTMLElement;
      if (!tabEl || !tabEl.dataset) return;
      const id = parseInt(tabEl.dataset.tabId || '0');
      if (target.classList.contains('tab-close')) this.closeTab(id, e);
      else this.switchTab(id);
    });

    this.newTabBtn?.addEventListener('click', () => this.createNewTab());
  }

  public async createNewTab(title = 'Terminal', type: any = 'local', params: any = {}): Promise<TabData | null> {
    const id = this.nextTabId++;
    const tab: TabData = {
      id, title, connectionType: type, connectionParams: params,
      isConnected: false, sessionId: null, xtermWrapper: null, container: null
    };
    this.tabs.set(id, tab);
    this.switchTab(id);
    return tab;
  }

  public switchTab(id: number): void {
    if (this.activeTabId === id) return;
    this.activeTabId = id;
    this.render();
  }

  public async closeTab(id: number, e?: Event): Promise<void> {
    if (e) e.stopPropagation();
    const tab = this.tabs.get(id);
    if (!tab) return;
    
    tab.xtermWrapper?.dispose?.();
    this.tabs.delete(id);

    if (this.activeTabId === id) {
      const remainingIds = Array.from(this.tabs.keys());
      if (remainingIds.length > 0) this.switchTab(remainingIds[remainingIds.length - 1]);
      else { this.activeTabId = null; this.render(); }
    } else {
      this.render();
    }
  }

  protected updateTabSession(tabId: number, sessionId: string, xtermWrapper: any, container?: HTMLElement | null): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.sessionId = sessionId;
      tab.xtermWrapper = xtermWrapper;
      tab.isConnected = !!sessionId;
    }
  }

  public render(): void {
    if (!this.tabsWrapper) return;
    const fragment = document.createDocumentFragment();
    this.tabs.forEach(tab => {
      const isActive = tab.id === this.activeTabId;
      const el = document.createElement('div');
      el.className = `tab ${isActive ? 'active' : ''}`;
      el.dataset.tabId = tab.id.toString();
      el.innerHTML = `<span class="tab-title">${tab.title}</span><span class="tab-close">&times;</span>`;
      fragment.appendChild(el);
    });
    this.tabsWrapper.innerHTML = '';
    this.tabsWrapper.appendChild(fragment);
  }

  public getActiveTab = () => this.activeTabId ? this.tabs.get(this.activeTabId) || null : null;
  public getTabById = (id: number | string) => this.tabs.get(Number(id));
  public getTabBySessionId = (sid: string) => Array.from(this.tabs.values()).find(t => t.sessionId === sid);
  protected saveState = () => {}; // 基础版暂不实现复杂持久化
}
