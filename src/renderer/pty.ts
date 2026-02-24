import { Logger } from './logger';
import type { PtyCreateOptions, XtermWrapper, PTYEventPayload, PTYExitPayload } from '../types/types';

export class PTYUI {
  // 使用 Map 确保 O(1) 查询效率
  private tabIdToSessionId = new Map<number, string>();
  private sessionToWrapper = new Map<string, XtermWrapper>();
  
  private activeTabId: number = -1;

  constructor() {
    this.initListeners();
    Logger.debug('PTYUI', 'Initialized');
  }

  /**
   * 初始化来自主进程的监听
   * 注意：这里不再需要 IpcRendererEvent，直接接收 Payload
   */
  private initListeners(): void {
    if (!window.electronAPI) {
      Logger.error('PTYUI', 'electronAPI not found. Make sure preload script is loaded.');
      return;
    }

    // 绑定数据到达事件
    window.electronAPI.onPtyData((payload: PTYEventPayload) => {
      this.handlePtyData(payload);
    });

    // 绑定退出事件
    window.electronAPI.onPtyExit((payload: PTYExitPayload) => {
      this.handlePtyExit(payload);
    });
  }

  /**
   * 创建 PTY 会话
   */
  async createSession(
    options: PtyCreateOptions
  ): Promise<{ success: boolean; sessionId: string; error?: string }> {
    Logger.debug('PTYUI', `Requesting PTY creation: ${options.type}`);
    return await window.electronAPI.ptyCreate(options);
  }

  /**
   * 将 UI 层的 Xterm 实例与后端 Session 绑定
   */
  attachWrapper(tabId: number, sessionId: string, wrapper: XtermWrapper): void {
    this.tabIdToSessionId.set(tabId, sessionId);
    this.sessionToWrapper.set(sessionId, wrapper);
    
    Logger.debug('PTYUI', `Attached Tab(${tabId}) to Session(${sessionId})`);

    if (tabId === this.activeTabId) {
      wrapper.focus();
    }
  }

  /**
   * 设置当前激活的标签页
   */
  setActiveTabId(tabId: number): void {
    this.activeTabId = tabId;
    const sid = this.tabIdToSessionId.get(tabId);
    if (sid) {
      const wrapper = this.sessionToWrapper.get(sid);
      wrapper?.focus();
    }
  }

  /**
   * 高频数据处理 (Hot Path)
   */
  private handlePtyData({ sessionId, data }: PTYEventPayload): void {
    const wrapper = this.sessionToWrapper.get(sessionId);
    if (wrapper) {
      wrapper.write(data);
    }
  }

  /**
   * PTY 退出处理
   */
  private handlePtyExit({ sessionId, code }: PTYExitPayload): void {
    Logger.info('PTYUI', `Session ${sessionId} exited with code: ${code}`);
    // 这里可以触发 UI 更新，比如在终端显示 "Process exited"
  }

  /**
   * 彻底移除并销毁终端实例
   */
  async removeSession(tabId: number): Promise<void> {
    const sid = this.tabIdToSessionId.get(tabId);
    if (sid) {
      // 1. 销毁前端实例
      const wrapper = this.sessionToWrapper.get(sid);
      if (wrapper) {
        wrapper.dispose();
        this.sessionToWrapper.delete(sid);
      }

      // 2. 移除映射
      this.tabIdToSessionId.delete(tabId);
      
      // 3. 通知主进程关闭 PTY 进程
      try {
        await window.electronAPI.ptyClose(sid);
      } catch (err) {
        Logger.error('PTYUI', `Failed to close PTY ${sid}`, err);
      }
    }
  }

  /**
   * 页面关闭/卸载前断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const sessionIds = Array.from(this.sessionToWrapper.keys());
    
    // 停止前端所有实例
    this.sessionToWrapper.forEach(wrapper => wrapper.dispose());
    this.sessionToWrapper.clear();
    this.tabIdToSessionId.clear();
    
    // 并行通知后端关闭
    await Promise.allSettled(sessionIds.map(sid => window.electronAPI.ptyClose(sid)));
    Logger.debug('PTYUI', 'All sessions disconnected');
  }
}