import { IpcRendererEvent } from 'electron';

// --- 基础协议定义 ---
export type SessionType = 'local' | 'ssh' | 'telnet';

// --- 辨析联合类型 (Discriminated Unions) ---
// 确保不同类型的连接拥有正确的参数约束
export interface BaseParams {
  type: SessionType;
  name: string;
}

// 具体实现：注意 type 使用字面量类型
export interface SSHParams extends BaseParams {
  type: 'ssh';
  host: string;
  port: number;
  user: string;
  password?: string;
  keyPath?: string;
}

export interface TelnetParams extends BaseParams {
  type: 'telnet';
  host: string;
  port: number;
}

export interface LocalParams extends BaseParams {
  type: 'local';
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
}

/** 核心配置：将类型与参数绑定 */
export type SessionConfig =
  | { type: 'local'; params: LocalParams }
  | { type: 'ssh'; params: SSHParams }
  | { type: 'telnet'; params: TelnetParams };

// --- IPC 响应结构 ---
export interface IpcResult<T = void> {
  sessionId: string;
  success: boolean;
  data?: T;
  message?: string;
  code?: number;
}

export type AllSessionParams = SSHParams | TelnetParams | LocalParams;

export class SessionFactory {
  /**
   * 动态创建 SessionConfig
   * @param input 包含 type 的扁平参数对象
   */
  static createConfig(input: AllSessionParams): SessionConfig {
    // 使用解构：提取 type，剩下的部分作为 params
    const { type, ...rest } = input;

    // 根据类型返回符合 SessionConfig 定义的结构
    switch (type) {
      case 'ssh':
        return { type: 'ssh', params: rest as Omit<SSHParams, 'type'> };
      case 'telnet':
        return { type: 'telnet', params: rest as Omit<TelnetParams, 'type'> };
      case 'local':
        return { type: 'local', params: rest as Omit<LocalParams, 'type'> };
      default:
        throw new Error(`Unsupported connection type: ${(input as any).type}`);
    }
  }
}

// --- PTY 数据负载 ---
export interface PTYEventPayload { sessionId: string; data: string; }
export interface PTYExitPayload { sessionId: string; code: number; }
export interface PTYErrorPayload { sessionId: string; error: string; }

// 定义一个创建 PTY 时的专用配置类型
export type PtyCreateOptions = SessionConfig & {
  tabId?: number;
  cols?: number;
  rows?: number;
};

// --- Electron API 接口 ---
export interface ElectronAPI {
  // 基础系统信息
  getWorkingDirectory: () => Promise<string>;
  getPlatform: () => Promise<NodeJS.Platform>;

  // 命令执行与测试
  executeCommand: (command: string, config?: SessionConfig) => Promise<IpcResult<string>>;
  testConnection: (config: SessionConfig) => Promise<IpcResult>;

  // PTY 会话管理
  ptyCreate: (options: PtyCreateOptions) => Promise<IpcResult<{ sessionId: string }>>;
  ptyWrite: (sessionId: string, data: string) => Promise<IpcResult>;
  ptyResize: (sessionId: string, cols: number, rows: number) => Promise<IpcResult>;
  ptyClose: (sessionId: string) => Promise<IpcResult>;
  ptyCloseAllByTab: (tabId: number) => Promise<IpcResult>;
  ptySetTab: (sessionId: string, tabId: number) => Promise<IpcResult>;
  ptyGetActiveSession: (tabId: number) => Promise<IpcResult<{ sessionId: string }>>;

  // 事件监听：采用“取消订阅”模式 (Unsubscribe Pattern)
  // 这种模式比 removeListener 更安全，不会导致误删其他组件的监听器
  onPtyData: (callback: (payload: PTYEventPayload) => void) => () => void;
  onPtyExit: (callback: (payload: PTYExitPayload) => void) => () => void;
  onPtyError: (callback: (payload: PTYErrorPayload) => void) => () => void;
}

// --- 全局对象扩展 ---
declare global {
  interface Window {
    readonly electronAPI: ElectronAPI;
    /** xterm.js 全局实例 (如果是通过 script 引入) */
    Terminal: any;
    FitAddon: any;
    app: any;
  }
}

// 确保该文件被视为模块
export {};