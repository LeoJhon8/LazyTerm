/** 基础类型定义 */
export type ConnectionType = 'local' | 'ssh' | 'telnet';

export interface SSHConnectionInfo {
  host: string;
  port: number;
  user: string;
  password?: string;
  keyPath?: string;
  cwd?: string;
  tabId?: number;
}

export interface TerminalContentLine {
  text: string;
  className: string;
}

/** 
 * Tab 接口定义 - 用于类型约束和状态传递
 */
export interface TabInfo {
  id: number;
  title: string;
  connectionType: ConnectionType;
  connectionParams: SSHConnectionInfo | null;
  content: TerminalContentLine[];
  commandHistory: string[];
  historyIndex: number;
  isExecuting: boolean;
  scrollTop?: number;
  sessionId: string | null;
  savedSessionId?: number;
}

/**
 * Tab 实体类 - 包含逻辑操作
 */
export class Tab implements TabInfo {
  // 核心属性
  content: TerminalContentLine[] = [];
  commandHistory: string[] = [];
  historyIndex = -1;
  isExecuting = false;
  scrollTop?: number = 0;
  sessionId: string | null = null;
  xtermWrapper: any = null; // 运行时对象，不参与序列化
  savedSessionId?: number;

  constructor(
    public readonly id: number,
    public title: string = 'Terminal',
    public connectionType: ConnectionType = 'local',
    public connectionParams: SSHConnectionInfo | null = null
  ) {
    this.content = this.getInitialContent();
  }

  /**
   * 生成初始欢迎信息
   */
  private getInitialContent(): TerminalContentLine[] {
    const lines: TerminalContentLine[] = [];
    const timestamp = new Date().toLocaleTimeString();

    switch (this.connectionType) {
      case 'local':
        lines.push({ text: `Lazy Terminal [Version 1.0.0]`, className: 'system-msg' });
        lines.push({ text: `Ready at ${timestamp}. Type 'help' for commands.`, className: 'dim' });
        break;
      case 'ssh':
      case 'telnet':
        const host = this.connectionParams?.host || 'unknown';
        const port = this.connectionParams?.port || (this.connectionType === 'ssh' ? 22 : 23);
        lines.push({ 
          text: `Connecting to ${this.connectionType.toUpperCase()}://${host}:${port}...`, 
          className: 'info-msg' 
        });
        break;
    }
    lines.push({ text: '', className: '' });
    return lines;
  }

  /**
   * 命令历史管理
   */
  addCommand(command: string): void {
    if (!command.trim()) return;
    // 避免重复记录相同的连续命令
    if (this.commandHistory[this.commandHistory.length - 1] !== command) {
      this.commandHistory.push(command);
    }
    this.historyIndex = -1;
  }

  /**
   * 获取历史命令（用于上下键导航）
   * @param direction 'up' | 'down'
   */
  getHistoryNav(direction: 'up' | 'down'): string | null {
    if (this.commandHistory.length === 0) return null;

    if (direction === 'up') {
      if (this.historyIndex === -1) this.historyIndex = this.commandHistory.length - 1;
      else if (this.historyIndex > 0) this.historyIndex--;
    } else {
      if (this.historyIndex === -1) return '';
      if (this.historyIndex < this.commandHistory.length - 1) this.historyIndex++;
      else {
        this.historyIndex = -1;
        return '';
      }
    }
    return this.commandHistory[this.historyIndex];
  }

  addLine(text: string, className = ''): void {
    this.content.push({ text, className });
    // 限制内容长度，防止内存溢出
    if (this.content.length > 1000) this.content.shift();
  }

  /**
   * 清理运行时资源
   */
  dispose(): void {
    this.xtermWrapper?.dispose?.();
    this.xtermWrapper = null;
  }

  /**
   * 序列化对象 - 自动排除无法序列化的字段
   */
  toJSON(): Partial<TabInfo> {
    const { id, title, connectionType, connectionParams, content, commandHistory, historyIndex, scrollTop, sessionId } = this;
    return {
      id,
      title,
      connectionType,
      connectionParams,
      content,
      commandHistory,
      historyIndex,
      scrollTop,
      sessionId
    };
  }

  /**
   * 静态工厂方法
   */
  static fromJSON(data: any): Tab {
    const tab = new Tab(
      data.id || Date.now(),
      data.title,
      data.connectionType,
      data.connectionParams
    );
    tab.content = data.content || [];
    tab.commandHistory = data.commandHistory || [];
    tab.historyIndex = data.historyIndex ?? -1;
    tab.scrollTop = data.scrollTop || 0;
    tab.sessionId = data.sessionId || null;
    return tab;
  }
}

/** 快捷命令接口 */
export interface ShortcutCommand {
  id: string; // 增加唯一标识
  label: string;
  command: string;
  alias: string;
  executeCount?: number;
  category?: string; // 增加分类支持
}

/** 会话持久化接口 */
export interface SessionInfo extends Omit<TabInfo, 'isExecuting' | 'xtermWrapper'> {
  name: string;
  savedAt: string;
  tags?: string[];
}

/** 历史记录项 */
export interface HistoryItem {
  command: string;
  timestamp: number;
  exitCode?: number; // 增加退出码记录
}