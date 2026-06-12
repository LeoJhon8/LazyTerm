import { Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeTauri, invokeTauriBackground } from "@/services/tauri";
import type { ConnectionStateEvent } from "@/types/terminal";
import { ConnectionStateEmitter } from "./ConnectionStateEmitter";

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
  private readonly stateEmitter: ConnectionStateEmitter;

  private readonly protocolName: string;
  private readonly createSessionCommand: string;
  private readonly closeSessionCommand: string;
  private readonly closeEventPrefix: string;

  constructor(
    config: TConfig,
    protocolName: string,
    createSessionCommand: string,
    closeSessionCommand: string,
    closeEventPrefix: string,
    frameParser: (packet: ArrayBuffer) => TFramePayload,
  ) {
    this.protocolName = protocolName;
    this.createSessionCommand = createSessionCommand;
    this.closeSessionCommand = closeSessionCommand;
    this.closeEventPrefix = closeEventPrefix;
    this.stateEmitter = new ConnectionStateEmitter(`FE/connector/${protocolName}/state`);
    this.config = config;
    this.frameChannel = new Channel<ArrayBuffer>((packet) => {
      const frame = frameParser(packet);
      this.frameSize = this.extractFrameSize(frame);
      this.latestFrame = frame;
      this.frameHandler?.(frame);
    });
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  /**
   * 建立连接
   */
  async open(): Promise<void> {
    if (this.sessionId) {
      return;
    }

    if (!this.connectPromise) {
      this.stateEmitter.emit({ phase: "connecting" });
      this.closedBeforeConnect = false;
      this.connectPromise = invokeTauri<string>(
        this.createSessionCommand,
        this.buildCreateSessionArgs(),
        {
          scope: `FE/connector/${this.protocolName}/open`,
          logStart: true,
          logSuccess: true,
        },
      ).then((sessionId) => {
        if (this.closedBeforeConnect) {
          invokeTauriBackground(
            this.closeSessionCommand,
            { sessionId },
            { scope: `FE/connector/${this.protocolName}/close` },
          );
          throw new Error(
            `${this.protocolName.toUpperCase()} connection was closed before initialization completed`,
          );
        }

        this.sessionId = sessionId;
        void this.ensureCloseListener(sessionId);
        this.stateEmitter.emit({ phase: "connected" });
        return sessionId;
      }).catch((error) => {
        this.stateEmitter.emit({
          phase: "failed",
          reason: `${this.protocolName.toUpperCase()} 连接失败`,
          technicalDetails: String(error),
        });
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

  /**
   * 注册帧处理器
   */
  async onFrame(handler: (frame: TFramePayload) => void): Promise<void> {
    const sessionId = await this.waitForSessionId();

    this.frameHandler = handler;
    await this.ensureCloseListener(sessionId);

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
   * 调整会话大小
   */
  abstract resize(width: number, height: number): void;

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
    this.stateEmitter.emit({ phase: "closing" });
    this.closedBeforeConnect = true;

    if (this.sessionId) {
      invokeTauriBackground(
        this.closeSessionCommand,
        { sessionId: this.sessionId },
        { scope: `FE/connector/${this.protocolName}/close` },
      );
    }

    this.cleanupListeners();
    this.sessionId = null;
  }

  /**
   * 等待 sessionId 可用
   */
  protected async waitForSessionId(): Promise<string> {
    if (this.sessionId) {
      return this.sessionId;
    }

    if (this.connectPromise) {
      return await this.connectPromise;
    }

    throw new Error(
      `${this.protocolName.toUpperCase()} session has not started opening yet`,
    );
  }

  /**
   * 构建创建会话的参数
   */
  protected abstract buildCreateSessionArgs(): Record<string, unknown>;

  /**
   * 从帧数据中提取尺寸信息
   */
  protected abstract extractFrameSize(frame: TFramePayload): { width: number; height: number };

  /**
   * 处理断开连接
   */
  protected handleDisconnect(): void {
    if (!this.sessionId) {
      return;
    }

    this.cleanupListeners();
    this.latestFrame = null;
    this.sessionId = null;
    this.stateEmitter.emit({
      phase: "disconnected",
      reason: `${this.protocolName.toUpperCase()} 连接已断开`,
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

    this.closeUnlisten = await listen(
      `${this.closeEventPrefix}-${sessionId}`,
      () => {
        this.handleDisconnect();
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
