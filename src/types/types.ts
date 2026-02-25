// --- 基础协议定义 ---
export type SessionType = 'local' | 'ssh' | 'telnet' | 'git-bash';

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
  timeout?: number;
}

export interface TelnetParams extends BaseParams {
  type: 'telnet';
  host: string;
  port: number;
  timeout?: number;
}

export interface LocalParams extends BaseParams {
  type: 'local';
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
}

export interface GitBashParams extends BaseParams {
  type: 'git-bash';
  cwd?: string;
  bashPath?: string;
  env?: Record<string, string>;
}

/** 核心配置：将类型与参数绑定 */
export type SessionConfig =
  | { type: 'local'; params: LocalParams }
  | { type: 'ssh'; params: SSHParams }
  | { type: 'telnet'; params: TelnetParams }
  | { type: 'git-bash'; params: GitBashParams };

// --- IPC 响应结构 ---
export interface IpcResult<T = void> {
  sessionId: string;
  success: boolean;
  data?: T;
  message?: string;
  code?: number;
}

export type AllSessionParams = SSHParams | TelnetParams | LocalParams | GitBashParams;

export class SessionFactory {
  /**
   * 动态创建 SessionConfig
   * @param input 包含 type 的扁平参数对象
   */
  static createConfig(input: AllSessionParams): SessionConfig {
    // 验证输入参数
    if (!input.type || !['local', 'ssh', 'telnet', 'git-bash'].includes(input.type)) {
      throw new Error(`Invalid connection type: ${input.type}`);
    }

    const { type, ...rest } = input;

    // 构造完整的参数对象
    const baseParams: BaseParams = { type, name: input.name };

    // 根据类型返回符合 SessionConfig 定义的结构
    switch (type) {
      case 'ssh':
        return { 
          type: 'ssh', 
          params: { 
            ...baseParams,
            host: (rest as any).host,
            port: (rest as any).port,
            user: (rest as any).user,
            password: (rest as any).password,
            keyPath: (rest as any).keyPath,
            timeout: (rest as any).timeout
          } as SSHParams 
        };
      case 'telnet':
        return { 
          type: 'telnet', 
          params: { 
            ...baseParams,
            host: (rest as any).host,
            port: (rest as any).port,
            timeout: (rest as any).timeout
          } as TelnetParams 
        };
      case 'local':
        return { 
          type: 'local', 
          params: { 
            ...baseParams,
            cwd: (rest as any).cwd,
            shell: (rest as any).shell,
            env: (rest as any).env
          } as LocalParams 
        };
      default:
        throw new Error(`Unsupported connection type: ${(input as any).type}`);
    }
  }

  /**
   * 验证 SessionConfig 是否有效
   */
  static validateConfig(config: SessionConfig): boolean {
    switch (config.type) {
      case 'ssh':
        return !!config.params.host && 
               typeof config.params.port === 'number' && 
               config.params.port > 0 && 
               config.params.port <= 65535 &&
               !!config.params.user;
      case 'telnet':
        return !!config.params.host && 
               typeof config.params.port === 'number' && 
               config.params.port > 0 && 
               config.params.port <= 65535;
      case 'local':
        return true; // local 类型总是有效的
      case 'git-bash':
        return true; // git-bash 类型总是有效的
      default:
        return false;
    }
  }
}

// --- PTY 数据负载 ---
export interface PTYEventPayload { 
  sessionId: string; 
  data: string; 
  timestamp?: Date;
}

export interface PTYExitPayload { 
  sessionId: string; 
  code: number; 
  signal?: string;
}

export interface PTYErrorPayload { 
  sessionId: string; 
  error: string; 
  stack?: string;
}

// 终端包装器接口
export interface XtermWrapper {
  sessionId: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  blur(): void;
  dispose(): void;
  cols: number;
  rows: number;
  isActive: boolean;
}

// 定义一个创建 PTY 时的专用配置类型
export type PtyCreateOptions = SessionConfig & {
  tabId?: number;
  cols?: number;
  rows?: number;
  termType?: string;
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
  ptyIsActive: (sessionId: string) => Promise<IpcResult<{ active: boolean }>>;

  // 事件监听：采用"取消订阅"模式 (Unsubscribe Pattern)
  // 这种模式比 removeListener 更安全，不会导致误删其他组件的监听器
  onPtyData: (callback: (event: any, payload: PTYEventPayload) => void) => () => void;
  onPtyExit: (callback: (event: any, payload: PTYExitPayload) => void) => () => void;
  onPtyError: (callback: (event: any, payload: PTYErrorPayload) => void) => () => void;
  onPtyConnect: (callback: (sessionId: string) => void) => () => void;
  onPtyDisconnect: (callback: (sessionId: string) => void) => () => void;
}

// --- 全局对象扩展 ---
declare global {
  interface Window {
    readonly electronAPI: ElectronAPI;
    /** xterm.js 全局实例 (如果是通过 script 引入) */
    Terminal: any;
    FitAddon: any;
    WebLinksAddon: any;
    SerializeAddon: any;
    app: any;
  }
}

// 确保该文件被视为模块
export {};
