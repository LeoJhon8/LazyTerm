import { Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeTauri, invokeTauriBackground } from "@/services/tauri";
import type { ConnectionStateEvent } from "@/types/terminal";
import { ConnectionStateEmitter } from "./ConnectionStateEmitter";
import { logger } from "@/lib/logger";
import { classifyConnectionFailure } from "@/services/connection/connectionErrors";
import { ConnectionReadinessBarrier } from "@/services/connection/ConnectionReadinessBarrier";

const GRAPHICAL_USABLE_CHECKPOINTS = ["identity", "listeners", "backend", "remote"] as const;

/**
 * 图形协议连接器的基础抽象类
 * 封装 RDP/VNC 等图形协议的公共生命周期逻辑
 */
export abstract class BaseGraphicalConnector<
  TConfig,
  TFramePayload,
  TPointerPayload,
  TKeyboardPayload,
> {
  protected static readonly FRAME_HEADER_SIZE = 13;

  protected readonly config: TConfig;
  protected readonly frameChannel: Channel<ArrayBuffer>;
  protected sessionId: string | null = null;
  protected connectPromise: Promise<string> | null = null;
  protected closedBeforeConnect = false;
  protected closeUnlisten: UnlistenFn | null = null;
  protected closeHandlers = new Set<() => void>();
  protected frameHandler: ((frame: TFramePayload) => void) | null = null;
  protected frameSize: { width: number; height: number } | null = null;
  protected latestFrame: TFramePayload | null = null;
  private hasReceivedFrame = false;
  private disconnected = false;
  private readonly readiness = new ConnectionReadinessBarrier();
  private readonly readinessCycle: number;
  private readonly stateEmitter: ConnectionStateEmitter;

  private readonly protocolName: "rdp" | "vnc";
  private readonly createSessionCommand: string;
  private readonly closeSessionCommand: string;
  private readonly closeEventPrefix: string;

  constructor(
    config: TConfig,
    protocolName: "rdp" | "vnc",
    createSessionCommand: string,
    closeSessionCommand: string,
    closeEventPrefix: string,
    frameParser: (packet: ArrayBuffer) => TFramePayload,
  ) {
    this.protocolName = protocolName;
    this.createSessionCommand = createSessionCommand;
    this.closeSessionCommand = closeSessionCommand;
    this.closeEventPrefix = closeEventPrefix;
    this.readinessCycle = this.readiness.begin();
    this.stateEmitter = new ConnectionStateEmitter(`FE/connector/${protocolName}/state`);
    this.config = config;
    this.frameChannel = new Channel<ArrayBuffer>((packet) => {
      try {
        const frame = frameParser(packet);
        this.frameSize = this.extractFrameSize(frame);
        this.latestFrame = frame;
        if (!this.hasReceivedFrame) {
          this.hasReceivedFrame = true;
          this.readiness.mark(this.readinessCycle, "first-data");
          if (this.isConnected) {
            this.stateEmitter.emit({ phase: "connected", stage: "steady", health: "healthy" });
          }
        }
        this.frameHandler?.(frame);
      } catch (error) {
        this.handleFrameParseError(error);
      }
    });
  }

  get isConnected(): boolean {
    return this.sessionId !== null
      && this.readiness.has(this.readinessCycle, GRAPHICAL_USABLE_CHECKPOINTS);
  }

  /**
   * 建立连接
   */
  async open(): Promise<void> {
    if (this.sessionId) {
      return;
    }

    if (!this.connectPromise) {
      this.stateEmitter.emit({ phase: "connecting", stage: "transport" });
      this.closedBeforeConnect = false;
      this.disconnected = false;
      this.hasReceivedFrame = false;
      const requestedSessionId = this.getRequestedSessionId();
      this.connectPromise = (async () => {
        if (!requestedSessionId) {
          throw new Error(`${this.protocolName.toUpperCase()} session identity is unavailable`);
        }
        this.readiness.mark(this.readinessCycle, "identity");
        await this.ensureCloseListener(requestedSessionId);
        await this.prepareProtocolListeners(requestedSessionId);
        this.readiness.mark(this.readinessCycle, "listeners");
        await this.readiness.waitFor(this.readinessCycle, ["identity", "listeners"]);

        return await invokeTauri<string>(
          this.createSessionCommand,
          this.buildCreateSessionArgs(),
          {
            scope: `FE/connector/${this.protocolName}/open`,
            logStart: true,
            logSuccess: true,
          },
        );
      })().then(async (sessionId) => {
        if (this.closedBeforeConnect || this.disconnected) {
          invokeTauriBackground(
            this.closeSessionCommand,
            { sessionId },
            { scope: `FE/connector/${this.protocolName}/close` },
          );
          this.cleanupListeners();
          throw new Error(
            `${this.protocolName.toUpperCase()} connection was closed before initialization completed`,
          );
        }

        this.sessionId = sessionId;
        await this.ensureCloseListener(sessionId);
        this.readiness.mark(this.readinessCycle, "backend");
        this.readiness.mark(this.readinessCycle, "remote");
        await this.readiness.waitFor(this.readinessCycle, GRAPHICAL_USABLE_CHECKPOINTS);
        this.stateEmitter.emit({
          phase: "connected",
          stage: this.hasReceivedFrame ? "steady" : "first-data",
          health: "healthy",
        });
        return sessionId;
      }).catch((error) => {
        this.readiness.fail(this.readinessCycle, error);
        if (this.sessionId) {
          invokeTauriBackground(
            this.closeSessionCommand,
            { sessionId: this.sessionId },
            { scope: `FE/connector/${this.protocolName}/close` },
          );
        }
        this.sessionId = null;
        this.cleanupListeners();
        if (!this.closedBeforeConnect && !this.disconnected) {
          const failure = classifyConnectionFailure(this.protocolName, error, { stage: "session" });
          this.stateEmitter.emit({
            phase: "failed",
            stage: failure.stage,
            reason: `${this.protocolName.toUpperCase()} 连接失败`,
            failure,
          });
        }
        throw error;
      }).finally(() => {
        this.connectPromise = null;
      });
    }

    await this.connectPromise;
  }

  onConnectionState(handler: (event: ConnectionStateEvent) => void): () => void {
    return this.stateEmitter.subscribe(handler);
  }

  protected emitConnectionState(event: ConnectionStateEvent): void {
    this.stateEmitter.emit(event);
  }

  /**
   * 注册帧处理器
   */
  async onFrame(handler: (frame: TFramePayload) => void): Promise<void> {
    await this.readiness.waitFor(this.readinessCycle, GRAPHICAL_USABLE_CHECKPOINTS);
    this.frameHandler = handler;

    if (this.latestFrame) {
      handler(this.latestFrame);
    }
  }

  /**
   * 注册关闭处理器
   */
  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  /**
   * 发送指针事件
   */
  abstract sendPointer(payload: TPointerPayload): void;

  /**
   * 发送键盘事件
   */
  abstract sendKey(payload: TKeyboardPayload): void;

  /**
   * 获取当前帧大小
   */
  getFrameSize(): { width: number; height: number } | null {
    return this.frameSize;
  }

  /**
   * 关闭连接
   */
  close(): void {
    this.stateEmitter.emit({ phase: "closing", stage: "closing" });
    this.closedBeforeConnect = true;
    this.readiness.fail(this.readinessCycle, new Error(`${this.protocolName.toUpperCase()} connection closed`));

    const sessionId = this.sessionId ?? this.getRequestedSessionId();
    if (sessionId) {
      invokeTauriBackground(
        this.closeSessionCommand,
        { sessionId },
        { scope: `FE/connector/${this.protocolName}/close` },
      );
    }

    this.cleanupListeners();
    this.sessionId = null;
    this.hasReceivedFrame = false;
    this.latestFrame = null;
    this.frameSize = null;
  }

  /**
   * 等待 sessionId 可用
   */
  protected async waitForSessionId(): Promise<string> {
    await this.readiness.waitFor(this.readinessCycle, GRAPHICAL_USABLE_CHECKPOINTS);
    if (!this.sessionId) {
      throw new Error(`${this.protocolName.toUpperCase()} session is not available`);
    }
    return this.sessionId;
  }

  /**
   * 构建创建会话的参数
   */
  protected abstract buildCreateSessionArgs(): Record<string, unknown>;

  /**
   * 可选的前端预分配会话 ID，用于在发起连接前注册精确的关闭监听器。
   */
  protected getRequestedSessionId(): string | null {
    return null;
  }

  protected async prepareProtocolListeners(_sessionId: string): Promise<void> {
    return Promise.resolve();
  }

  protected waitUntilUsable(): Promise<void> {
    return this.readiness.waitFor(this.readinessCycle, GRAPHICAL_USABLE_CHECKPOINTS);
  }

  protected isConnectionClosed(): boolean {
    return this.closedBeforeConnect || this.disconnected;
  }

  protected handleFrameParseError(error: unknown): void {
    logger.error(
      `FE/connector/${this.protocolName}/frame`,
      "Rejected malformed graphical frame",
      { error },
    );
  }

  /**
   * 从帧数据中提取尺寸信息
   */
  protected abstract extractFrameSize(frame: TFramePayload): { width: number; height: number };

  /**
   * 处理断开连接
   */
  protected handleDisconnect(reason?: unknown): void {
    if (this.disconnected || this.closedBeforeConnect) {
      return;
    }

    this.disconnected = true;
    this.readiness.fail(
      this.readinessCycle,
      reason ?? `${this.protocolName.toUpperCase()} connection closed`,
    );
    this.cleanupListeners();
    this.latestFrame = null;
    this.frameSize = null;
    this.sessionId = null;
    this.hasReceivedFrame = false;
    const failure = classifyConnectionFailure(
      this.protocolName,
      reason ?? `${this.protocolName.toUpperCase()} connection closed`,
      { stage: "steady", fallbackCode: "REMOTE_CLOSED" },
    );
    this.stateEmitter.emit({
      phase: "disconnected",
      stage: "steady",
      reason: `${this.protocolName.toUpperCase()} 连接已断开`,
      failure,
    });
    this.closeHandlers.forEach((handler) => handler());
  }

  /**
   * 确保关闭监听器已注册
   */
  private async ensureCloseListener(sessionId: string): Promise<void> {
    if (this.closeUnlisten) {
      return;
    }

    this.closeUnlisten = await listen<string | null>(
      `${this.closeEventPrefix}-${sessionId}`,
      (event) => {
        this.handleDisconnect(event.payload);
      },
    );
  }

  /**
   * 清理监听器
   */
  protected cleanupListeners(): void {
    if (this.closeUnlisten) {
      this.closeUnlisten();
      this.closeUnlisten = null;
    }

    this.frameHandler = null;
  }
}
