import type { IpcRendererEvent } from 'electron';
import type { PtyCreateOptions } from '../../types/electron';
import { Logger } from './logger';

// 扩展终端包装器接口，确保包含 sessionId
interface XtermWrapper extends XtermWrapperType {
  sessionId: string;
}

interface XtermWrapperType {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  blur(): void;
  setFontSize(size: number): void;
  fit(): void;
  dispose(): void; // xterm 标准销毁方法是 dispose
  cols: number;
  rows: number;
}

interface XtermConfig {
  theme: any;
  fontFamily: string;
  fontSize: number;
  cursorStyle: 'block' | 'underline' | 'bar';
}

export class PTYUI {
  // 使用双向映射提高查找效率
  private tabIdToSessionId = new Map<number, string>();
  private sessionToWrapper = new Map<string, XtermWrapper>();
  
  private activeTabId: number = -1;

  constructor() {
    Logger.debug('PTYUI', 'Initialized');
  }

  /**
   * 设置当前激活的标签页 ID
   */
  setActiveTabId(tabId: number): void {
    this.activeTabId = tabId;
    const sid = this.tabIdToSessionId.get(tabId);
    if (sid) {
      this.sessionToWrapper.get(sid)?.focus();
    }
  }

  /**
   * 创建 PTY 会话
   */
  async createSession(
    ptySession: PtyCreateOptions
  ): Promise<{ success: boolean; sessionId: string; error?: string }> {
    Logger.debug('PTYUI', `Creating ${ptySession.type} session`);
    // 直接透传，不再写冗余的 if-else
    return await window.electronAPI.ptyCreate(ptySession);
  }

  /**
   * 关联 Tab、Session 和终端实例
   */
  attachWrapper(tabId: number, sessionId: string, wrapper: XtermWrapper): void {
    this.tabIdToSessionId.set(tabId, sessionId);
    this.sessionToWrapper.set(sessionId, wrapper);
    
    if (tabId === this.activeTabId) {
      wrapper.focus();
    }
  }

  /**
   * 获取终端实例
   */
  getWrapperByTabId(tabId: number): XtermWrapper | undefined {
    const sid = this.tabIdToSessionId.get(tabId);
    return sid ? this.sessionToWrapper.get(sid) : undefined;
  }

  /**
   * 彻底移除并销毁终端实例
   */
  removeSession(tabId: number): void {
    const sid = this.tabIdToSessionId.get(tabId);
    if (sid) {
      const wrapper = this.sessionToWrapper.get(sid);
      wrapper?.dispose(); // 释放 xterm 资源
      this.sessionToWrapper.delete(sid);
      this.tabIdToSessionId.delete(tabId);
      
      // 通知主进程关闭 PTY
      window.electronAPI.ptyClose(sid).catch(err => 
        Logger.error('PTYUI', `Failed to close PTY ${sid}`, err)
      );
    }
  }

  /**
   * 高频数据处理函数 (Hot Path)
   * 优化点：使用 Map.get 代替 Array.find，复杂度从 O(n) 降到 O(1)
   */
  onPtyData(_event: IpcRendererEvent, { sessionId, data }: { sessionId: string, data: string }): void {
    const wrapper = this.sessionToWrapper.get(sessionId);
    if (wrapper) {
      wrapper.write(data);
    }
  }

  /**
   * PTY 退出处理
   */
  onPtyExit(_event: IpcRendererEvent, { sessionId, code }: { sessionId: string, code: number }): void {
    Logger.info('PTYUI', `Session ${sessionId} exited with code: ${code}`);
    // 可以在这里触发 UI 上的断开连接状态显示
  }

  /**
   * 页面关闭前断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const sessionIds = Array.from(this.sessionToWrapper.keys());
    const closePromises = sessionIds.map(sid => window.electronAPI.ptyClose(sid));
    
    this.sessionToWrapper.clear();
    this.tabIdToSessionId.clear();
    
    await Promise.allSettled(closePromises);
  }
}