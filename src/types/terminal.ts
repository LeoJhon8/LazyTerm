// 终端连接器接口定义
export interface ITerminalConnector {
  // 基础元数据
  readonly protocol: 'ssh' | 'local' | 'telnet';
  readonly isConnected: boolean;

  // 生命周期管理
  open(): Promise<void>;
  close(): void;

  // 数据流交互
  onData(handler: (data: string) => void): Promise<void>;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
}

// SSH 认证方式
export type SSHAuthType = 'password' | 'privateKey';

// SSH 连接配置
export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  // 认证方式
  authType: SSHAuthType;
  // 密码认证（当 authType 为 password 时必需）
  password?: string;
  // 私钥路径或内容（当 authType 为 privateKey 时必需）
  privateKeyPath?: string;
  privateKey?: string;
  // 可选配置
  nickname?: string;
  // 高级选项
  keepAlive?: boolean;
  keepAliveInterval?: number;
  readyTimeout?: number;
}

// 本地终端配置
export interface LocalConfig {
  cwd?: string;
  shell?: string;
}

// Telnet 配置
export interface TelnetConfig {
  host: string;
  port: number;
}
