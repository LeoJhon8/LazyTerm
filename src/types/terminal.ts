// 终端连接器接口定义
export interface ITerminalConnector {
  // 基础元数据
  readonly protocol: 'ssh' | 'local' | 'telnet';
  readonly isConnected: boolean;

  // 生命周期管理
  open(): Promise<void>;
  close(): void;

  // 数据流交互
  onData(handler: (data: string) => void): void;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
}

// SSH连接配置
export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

// 本地终端配置
export interface LocalConfig {
  cwd?: string;
  shell?: string;
}

// Telnet配置
export interface TelnetConfig {
  host: string;
  port: number;
}