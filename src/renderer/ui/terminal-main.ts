// terminal-main.ts
import { TabsUI, TabsUIConfig, TabData } from './tabs-ui';
import { SessionUI } from './session-ui';
import { HistoryUI } from './history-ui';
import { QuickCmdUI } from './quickcmd-ui';
import type { ConnectionType, ConnectionConfig } from '../../types/electron';
import { Logger } from './logger';

declare global {
  interface Window {
    app?: any;
  }
}

class TerminalMain extends TabsUI {
  private sessionUI = new SessionUI();
  private historyUI = new HistoryUI();
  private quickCmdUI = new QuickCmdUI();
  private fontSize: number;
  private disposables: Array<() => void> = [];

  constructor(config: TabsUIConfig) {
    super(config);
    this.fontSize = this.loadFontSize();
  }

  public override init(): void {
    // 1. 初始化子模块
    [this.sessionUI, this.historyUI, this.quickCmdUI].forEach(ui => ui.init());
    
    // 2. 运行父类初始化流程 (会按序调用下面 override 的方法)
    super.init();

    // 3. 启动终端特有的 PTY 监听
    this.initPTYListeners();
  }

  protected override setupGlobalEventListeners(): void {
    const handlers: Record<string, () => void> = {
      'toggleShortcutBtn': () => this.quickCmdUI.toggle(),
      'toggleHistoryBtn': () => this.historyUI.toggle(),
    };
    Object.entries(handlers).forEach(([id, fn]) => {
      const el = document.getElementById(id);
      if (el) el.onclick = fn;
    });
  }

  protected override bindSubModuleEvents(): void {
    (this.sessionUI as any).openSessionInNewTab = (s: any) => this.createNewTab(s.name, s.type, s.params);
  }

  protected override mountGlobalAPI(): void {
    window.app = {
      activeTab: this.getActiveTab(),
      addCommandToHistory: (cmd: string) => this.historyUI.addCommand(cmd),
      createNewTab: (title: string, type: ConnectionType, params: any) => this.createNewTab(title, type, params)
    };
  }

  private initPTYListeners(): void {
    const api = window.electronAPI;
    if (!api) return;

    this.disposables.push(api.onPtyData(({ sessionId, data }) => {
      this.getTabBySessionId(sessionId)?.xtermWrapper?.write(data);
    }));

    this.disposables.push(api.onPtyExit(({ sessionId, code }) => {
      Logger.info('Main', `Session ${sessionId} exited (${code})`);
      this.getTabBySessionId(sessionId)?.xtermWrapper?.writeln('\r\n[Process Exited]');
    }));
  }

  public override async createNewTab(title = 'LazyTerm', type: ConnectionType = 'local', params: any = {}): Promise<TabData | null> {
    const tabData = await super.createNewTab(title, type, params);
    if (!tabData) return null;

    const container = document.getElementById('xterm-container');
    if (!container) return null;
    container.innerHTML = ''; 

    try {
      const { default: XtermWrapper } = await import('../xtermWrapper');
      const xtermWrapper = new XtermWrapper(container, { fontSize: this.fontSize });
      
      this.updateTabSession(tabData.id, "", xtermWrapper);

      // 构造符合 .d.ts 定义的单对象参数
      const config: any = { 
        type, 
        params, 
        tabId: tabData.id,
        cols: 80, 
        rows: 24 
      };

      const result = await window.electronAPI.ptyCreate(config);
      if (result.success && result.data) {
        this.updateTabSession(tabData.id, result.data.sessionId, xtermWrapper);
        xtermWrapper.setSession(result.data.sessionId);
        xtermWrapper.connect();
      } else {
        xtermWrapper.writeln(`\r\n\x1b[31mError: ${result.message}\x1b[0m`);
      }
    } catch (err) {
      Logger.error('Main', 'Failed to create terminal', err);
    }
    return tabData;
  }

  public override async closeTab(id: number, e?: Event): Promise<void> {
    const tab = this.getTabById(id);
    if (tab?.sessionId) {
      await window.electronAPI.ptyClose(tab.sessionId);
    }
    await super.closeTab(id, e);
  }

  public changeFontSize(delta: number): void {
    this.fontSize = Math.max(10, Math.min(24, this.fontSize + delta));
    const tab = this.getActiveTab();
    if (tab?.xtermWrapper) {
      tab.xtermWrapper.setFontSize(this.fontSize);
      tab.xtermWrapper.refit();
    }
    localStorage.setItem('terminalFontSize', this.fontSize.toString());
  }
}

export default TerminalMain;