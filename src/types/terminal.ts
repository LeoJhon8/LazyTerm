export type SessionProtocol = 'ssh' | 'local' | 'rdp' | 'vnc' | 'serial' | 'telnet' | 'ai-cli';
export type RdpBackend = 'freerdp' | 'msrdpax';

export type SessionConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed'
  | 'closing';

export type ConnectionStage =
  | 'idle'
  | 'resolving'
  | 'transport'
  | 'security'
  | 'authentication'
  | 'session'
  | 'first-data'
  | 'steady'
  | 'closing';

export type ConnectionHealth = 'unknown' | 'healthy' | 'degraded' | 'stalled';

export type ConnectionErrorCategory =
  | 'network'
  | 'authentication'
  | 'security'
  | 'protocol'
  | 'device'
  | 'configuration'
  | 'resource'
  | 'internal';

export type ConnectionErrorCode =
  | 'DNS_NOT_FOUND'
  | 'NETWORK_UNREACHABLE'
  | 'CONNECT_REFUSED'
  | 'CONNECT_TIMEOUT'
  | 'IO_TIMEOUT'
  | 'REMOTE_CLOSED'
  | 'AUTH_REJECTED'
  | 'HOST_KEY_CHANGED'
  | 'CERT_UNTRUSTED'
  | 'PROTOCOL_NEGOTIATION_FAILED'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_BUSY'
  | 'DEVICE_REMOVED'
  | 'CONFIG_INVALID'
  | 'QUEUE_OVERFLOW'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN';

export interface ConnectionFailure {
  code: ConnectionErrorCode;
  category: ConnectionErrorCategory;
  stage: ConnectionStage;
  retryable: boolean;
  technicalDetails: string;
}

export type ConnectionQualityMode = 'interactive' | 'balanced' | 'background' | 'suspended';

export interface ConnectionQualityPolicy {
  mode: ConnectionQualityMode;
  priority: number;
  targetFrameRate: number;
  jpegQualityCap: number;
  suspendVisuals: boolean;
}

export interface ConnectionStateEvent {
  phase: SessionConnectionPhase;
  stage?: ConnectionStage;
  health?: ConnectionHealth;
  terminal?: boolean;
  failure?: ConnectionFailure;
  generation?: number;
  attempt?: number;
  retryAt?: number;
  reason?: string;
  technicalDetails?: string;
}

export interface SessionConnectionStatus extends ConnectionStateEvent {
  changedAt: number;
  connectedAt?: number;
  attempt: number;
}

export interface ISessionConnector {
  readonly protocol: SessionProtocol;
  readonly isConnected: boolean;

  open(): Promise<void>;
  close(): void;
  onConnectionState(handler: (event: ConnectionStateEvent) => void): () => void;
  applyQualityPolicy?(policy: ConnectionQualityPolicy): void;
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

export interface VncKeySequencePayload {
  keySyms: number[];
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
  generation?: number;
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
  setInitialViewportSize(width: number, height: number): void;
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
  setOverlayRect(rect: NativeHostRect | null): Promise<void>;
  setVisible(visible: boolean): Promise<void>;
  focus(): Promise<void>;
}

export interface IVncConnector extends ISessionConnector {
  readonly protocol: 'vnc';

  onFrame(handler: (frame: VncFramePayload) => void): Promise<void>;
  onCursor(handler: (cursor: VncCursorPayload) => void): Promise<void>;
  onClipboard(handler: (text: string) => void): Promise<void>;
  onClose(handler: () => void): () => void;
  sendPointer(payload: VncPointerPayload): void;
  sendKey(payload: VncKeyboardPayload): void;
  sendKeySequence(payload: VncKeySequencePayload): void;
  pasteClipboard(text: string, keySym: number, modifierKeySyms: number[]): Promise<void>;
  typeText(text: string, modifierKeySyms: number[]): Promise<void>;
  requestFrame(full?: boolean): void;
  resize(width: number, height: number): void;
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
  startupCommand?: string;
  // 高级选项
  keepAlive?: boolean;
  keepAliveInterval?: number;
  readyTimeout?: number;

}

// 本地终端配置
export interface LocalConfig {
  cwd?: string;
  shell?: string;
  nickname?: string;
  admin?: boolean;
  startupCommand?: string;
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
  backend?: RdpBackend;
}

export interface VNCConfig {
  host: string;
  port: number;
  credentialId?: string;
  password?: string;
  nickname?: string;
  shared?: boolean;
  viewOnly?: boolean;
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
