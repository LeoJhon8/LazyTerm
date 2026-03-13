export type SessionProtocol = 'ssh' | 'local' | 'telnet' | 'rdp';

export interface ISessionConnector {
  readonly protocol: SessionProtocol;
  readonly isConnected: boolean;

  open(): Promise<void>;
  close(): void;
}

// 终端连接器接口定义
export interface ITerminalConnector extends ISessionConnector {
  readonly protocol: 'ssh' | 'local' | 'telnet';

  onData(handler: (data: string) => void): Promise<void>;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
}

export interface RdpFramePayload {
  width: number;
  height: number;
  mimeType: string;
  imageBase64: string;
}

export interface RdpPointerPayload {
  kind: 'move' | 'down' | 'up' | 'wheel';
  x: number;
  y: number;
  button?: number;
  deltaX?: number;
  deltaY?: number;
}

export interface RdpKeyboardPayload {
  scancode: number;
  down: boolean;
}

export interface IRdpConnector extends ISessionConnector {
  readonly protocol: 'rdp';

  onFrame(handler: (frame: RdpFramePayload) => void): Promise<void>;
  onClose(handler: () => void): () => void;
  sendPointer(payload: RdpPointerPayload): void;
  sendKey(payload: RdpKeyboardPayload): void;
  releaseInputs(): void;
  resize(width: number, height: number): void;
  getFrameSize(): { width: number; height: number } | null;
}

export type SessionConnector = ITerminalConnector | IRdpConnector;

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

export interface RDPConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  domain?: string;
  nickname?: string;
  width?: number;
  height?: number;
  autoResize?: boolean;
}
