export type SessionProtocol = 'ssh' | 'local' | 'rdp' | 'vnc' | 'serial' | 'telnet' | 'ai-cli';
export type RdpBackend = 'freerdp' | 'msrdpax';

export interface ISessionConnector {
  readonly protocol: SessionProtocol;
  readonly isConnected: boolean;

  open(): Promise<void>;
  close(): void;
}

// 终端连接器接口定义
export interface ITerminalConnector extends ISessionConnector {
  readonly protocol: 'ssh' | 'local' | 'serial' | 'telnet' | 'ai-cli';

  onData(handler: (data: string) => void): Promise<void | (() => void)>;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
}

export interface RdpFramePayload {
  desktopWidth: number;
  desktopHeight: number;
  regionLeft: number;
  regionTop: number;
  regionWidth: number;
  regionHeight: number;
  fullFrame: boolean;
  encoding: "jpeg" | "rgba";
  imageBytes: ArrayBuffer;
}

export interface VncFramePayload {
  desktopWidth: number;
  desktopHeight: number;
  regionLeft: number;
  regionTop: number;
  regionWidth: number;
  regionHeight: number;
  fullFrame: boolean;
  encoding: "jpeg" | "rgba" | "png";
  imageBytes: ArrayBuffer;
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

export interface VncPointerPayload {
  x: number;
  y: number;
  buttonMask: number;
}

export interface VncKeyboardPayload {
  keySym: number;
  down: boolean;
}

export interface VncCursorPayload {
  hotspotX: number;
  hotspotY: number;
  width: number;
  height: number;
  rgbaBytes: Uint8Array;
}

export interface NativeHostRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export type NativeRdpSessionState =
  | 'launching'
  | 'ready'
  | 'host-ready'
  | 'control-created'
  | 'mounted'
  | 'visible'
  | 'hidden'
  | 'focused'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'state'
  | 'error'
  | 'closed';

export interface NativeRdpStatePayload {
  state: NativeRdpSessionState;
  detail?: string;
  rect?: NativeHostRect;
}

export interface IRdpConnector extends ISessionConnector {
  readonly protocol: 'rdp';
  readonly backend: 'freerdp';

  onFrame(handler: (frame: RdpFramePayload) => void): Promise<void>;
  onClose(handler: () => void): () => void;
  sendPointer(payload: RdpPointerPayload): void;
  sendKey(payload: RdpKeyboardPayload): void;
  releaseInputs(): void;
  resize(width: number, height: number): void;
  requestFrame(): void;
  getFrameSize(): { width: number; height: number } | null;
}

export interface INativeRdpConnector extends ISessionConnector {
  readonly protocol: 'rdp';
  readonly backend: 'msrdpax';

  getLatestState(): NativeRdpStatePayload;
  hasEverConnected(): boolean;
  onState(handler: (payload: NativeRdpStatePayload) => void): Promise<void>;
  onClose(handler: () => void): () => void;
  mount(rect: NativeHostRect): Promise<void>;
  setVisible(visible: boolean): Promise<void>;
  focus(): Promise<void>;
}

export interface IVncConnector extends ISessionConnector {
  readonly protocol: 'vnc';

  onFrame(handler: (frame: VncFramePayload) => void): Promise<void>;
  onCursor(handler: (cursor: VncCursorPayload) => void): Promise<void>;
  onClose(handler: () => void): () => void;
  sendPointer(payload: VncPointerPayload): void;
  sendKey(payload: VncKeyboardPayload): void;
  requestFrame(full?: boolean): void;
  getFrameSize(): { width: number; height: number } | null;
}

export type SessionConnector = ITerminalConnector | IRdpConnector | INativeRdpConnector | IVncConnector;

// SSH 认证方式
export type SSHAuthType = 'password' | 'privateKey';


// SSH 连接配置
export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  credentialId?: string;
  // 认证方式
  authType: SSHAuthType;
  // 密码认证（当 authType 为 password 时必需）
  password?: string;
  // 私钥路径或内容（当 authType 为 privateKey 时必需）
  privateKeyPath?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
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

export interface TelnetConfig {
  host: string;
  port: number;
  nickname?: string;
}



export interface RDPConfig {
  host: string;
  port: number;
  username: string;
  credentialId?: string;
  password?: string;
  domain?: string;
  nickname?: string;
  width?: number;
  height?: number;
  autoResize?: boolean;
  backend?: RdpBackend;
}

export interface VNCConfig {
  host: string;
  port: number;
  credentialId?: string;
  password?: string;
  nickname?: string;
  shared?: boolean;
  allowJpeg?: boolean;
  quality?: number;
}

export interface SerialConfig {
  port: string;
  baudRate: number;
  dataBits: number;
  parity: 'None' | 'Odd' | 'Even';
  stopBits: number;
  flowControl: 'None' | 'Software' | 'Hardware';
  nickname?: string;
}

export function isGraphicalProtocol(protocol: SessionProtocol): protocol is 'rdp' | 'vnc' {
  return protocol === 'rdp' || protocol === 'vnc';
}

export function isTerminalProtocol(protocol: SessionProtocol): protocol is 'ssh' | 'local' | 'serial' | 'telnet' {
  return protocol === 'ssh' || protocol === 'local' || protocol === 'serial' || protocol === 'telnet';
}

// AI CLI 连接配置（极简版 - 只负责启动 CLI）
export interface AiCliConfig {
  command: string;           // CLI 命令，如 "claude", "openai", "gemini"
  args?: string[];           // 启动参数（可选）
  cwd?: string;              // 工作目录（可选）
  nickname?: string;          // 显示名称（可选）
}
