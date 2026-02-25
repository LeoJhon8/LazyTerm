// terminal-main.ts
import { TabsUI, TabsUIConfig, TabData } from './tabs';
import { SessionUI } from './session';
import { HistoryUI } from './history';
import { QuickCmdUI } from './quickcmd';
import type { SessionType } from '../types/types';
import { Logger } from './logger';
import '@xterm/xterm/css/xterm.css';

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
    this.sessionUI.init();
    this.historyUI.init();
    this.quickCmdUI.init();
    super.init();
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
    (this.sessionUI as any).createTabFromSession = (s: any) => this.createNewTab(s.params.name, s.type, s.params);
  }

  protected override mountGlobalAPI(): void {
    window.app = {
      activeTab: this.getActiveTab(),
      addCommandToHistory: (cmd: string) => this.historyUI.addCommand(cmd),
      createNewTab: (title: string, type: SessionType, params: any) => this.createNewTab(title, type, params)
    };
  }

  private initPTYListeners(): void {
    const api = window.electronAPI;
    if (!api) {
      console.error('[TerminalMain] electronAPI not available');
      return;
    }

    this.disposables.push(api.onPtyData((event, payload) => {
      const { sessionId, data } = payload || {};
      console.log(`[TerminalMain] Received PTY data for session ${sessionId}:`, data ? data.substring(0, 100) : '(empty)');
      const tab = this.getTabBySessionId(sessionId);
      if (!tab) {
        console.warn(`[TerminalMain] Tab not found for session ${sessionId}`);
        return;
      }
      if (!tab.xtermWrapper) {
        console.warn(`[TerminalMain] xtermWrapper not found for tab ${tab.id}`);
        return;
      }
      tab.xtermWrapper.write(data);
    }));

    this.disposables.push(api.onPtyExit((event, payload) => {
      const { sessionId, code } = payload || {};
      Logger.info('Main', `Session ${sessionId} exited (${code})`);
      this.getTabBySessionId(sessionId)?.xtermWrapper?.writeln('\r\n[Process Exited]');
    }));
  }

  public override async createNewTab(title = 'LazyTerm', type: SessionType = 'local', params: any = {}): Promise<TabData | null> {
    const tabData = await super.createNewTab(title, type, params);
    if (!tabData) return null;

    const terminalWrapper = document.getElementById('terminalWrapper');
    if (!terminalWrapper) return null;

    try {
      const { default: XtermWrapper } = await import('./xtermWrapper');
      
      const container = document.createElement('div');
      container.className = 'terminal-container';
      container.id = `terminal-container-${tabData.id}`;
      container.style.display = 'none';
      terminalWrapper.appendChild(container);
      
      const xtermWrapper = new XtermWrapper(container, { fontSize: this.fontSize });
      
      this.updateTabSession(tabData.id, "", xtermWrapper, container);

      const sessionParams: any = params.name ? params : { ...params, name: title };
      const config: any = { 
        type, 
        params: sessionParams,
        tabId: tabData.id,
        cols: 80, 
        rows: 24 
      };

      console.log(`[TerminalMain] Creating PTY session with config:`, config);
      const result = await window.electronAPI.ptyCreate(config);
      console.log(`[TerminalMain] PTY create result:`, result);
      
      if (result.success && result.data) {
        this.updateTabSession(tabData.id, result.data.sessionId, xtermWrapper, container);
        xtermWrapper.setSession(result.data.sessionId);
        xtermWrapper.connect();
        
        container.style.display = 'block';
        xtermWrapper.focus();
        console.log(`[TerminalMain] Session ${result.data.sessionId} created and connected`);
      } else {
        xtermWrapper.writeln(`\r\n\x1b[31mError: ${result.message}\x1b[0m`);
      }
    } catch (err) {
      Logger.error('Main', 'Failed to create terminal', err);
    }
    return tabData;
  }

  public override switchTab(id: number): void {
    const prevTab = this.getActiveTab();
    super.switchTab(id);
    
    const nextTab = this.getActiveTab();
    
    if (prevTab && prevTab.container) {
      prevTab.container.style.display = 'none';
      prevTab.xtermWrapper?.blur();
    }
    
    if (nextTab && nextTab.container) {
      nextTab.container.style.display = 'block';
      setTimeout(() => {
        nextTab.xtermWrapper?.focus();
        nextTab.xtermWrapper?.refit();
      }, 0);
    }
  }

  public override async closeTab(id: number, e?: Event): Promise<void> {
    const tab = this.getTabById(id);
    if (tab?.sessionId) {
      await window.electronAPI.ptyClose(tab.sessionId);
    }
    
    if (tab?.container) {
      tab.xtermWrapper?.dispose();
      tab.container.remove();
    }
    
    await super.closeTab(id, e);
    
    if ((this as any).tabs.size === 0) {
      this.createNewTab('LazyTerm', 'local');
    }
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

  protected updateTabSession(tabId: number, sessionId: string, xtermWrapper: any, container?: HTMLElement | null): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.sessionId = sessionId;
      tab.xtermWrapper = xtermWrapper;
      tab.container = container;
      tab.isConnected = !!sessionId;
    }
  }
}

export default TerminalMain;
