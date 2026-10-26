import type {
  IRdpConnector,
  ConnectionQualityPolicy,
  RDPConfig,
  RdpFramePayload,
  RdpKeyboardPayload,
  RdpAction,
  RdpEvent,
  RdpPointerPayload,
} from "@/types/terminal";
import { logger } from "@/lib/logger";
import { invokeTauri } from "@/services/tauri";
import { BaseGraphicalConnector } from "./BaseGraphicalConnector";
import { Channel } from "@tauri-apps/api/core";

export class RdpConnector
  extends BaseGraphicalConnector<RDPConfig, RdpFramePayload, RdpPointerPayload, RdpKeyboardPayload>
  implements IRdpConnector
{
  readonly protocol = "rdp" as const;
  readonly backend = "freerdp" as const;
  private readonly requestedSessionId = crypto.randomUUID();
  private initialViewportSize: { width: number; height: number } | null = null;
  private initialViewportLocked = false;
  private readonly eventHandlers = new Set<(event: RdpEvent) => void>();
  private latestCursor: RdpEvent | null = null;
  private lastRequestedSize = "";
  private readonly eventChannel = new Channel<RdpEvent>((event) => {
    if (this.isConnectionClosed()) return;
    if (event.kind === "cursor") this.latestCursor = event;
    for (const handler of this.eventHandlers) handler(event);
  });
  private resolveInitialViewport: (() => void) | null = null;
  private readonly initialViewportReady = new Promise<void>((resolve) => {
    this.resolveInitialViewport = resolve;
  });

  constructor(config: RDPConfig) {
    super(
      config,
      "rdp",
      "create_rdp_session",
      "close_rdp_session",
      "rdp-close",
      RdpConnector.parseFramePacket,
    );
  }

  sendPointer(payload: RdpPointerPayload): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    invokeTauri(
      "send_rdp_pointer",
      { sessionId: this.sessionId, payload },
      { scope: "FE/connector/rdp/pointer" },
    ).catch((error) => {
      logger.error("FE/connector/rdp/pointer", "Pointer input failed", error);
    });
  }

  sendKey(payload: RdpKeyboardPayload): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    invokeTauri(
      "send_rdp_key",
      { sessionId: this.sessionId, payload },
      { scope: "FE/connector/rdp/key" },
    ).catch((error) => {
      logger.error("FE/connector/rdp/key", "Keyboard input failed", error);
    });
  }

  releaseInputs(): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    invokeTauri(
      "release_rdp_inputs",
      { sessionId: this.sessionId },
      { scope: "FE/connector/rdp/release" },
    ).catch((error) => {
      logger.error("FE/connector/rdp/release", "Releasing inputs failed", error);
    });
  }

  async sendAction(action: RdpAction): Promise<void> {
    if (!this.isConnected || !this.sessionId) return;
    await invokeTauri("send_rdp_action", { sessionId: this.sessionId, action }, { scope: "FE/connector/rdp/action" });
  }

  onEvent(handler: (event: RdpEvent) => void): () => void {
    this.eventHandlers.add(handler);
    if (this.latestCursor) handler(this.latestCursor);
    return () => { this.eventHandlers.delete(handler); };
  }

  async open(): Promise<void> {
    await super.open();
    this.resizeToViewport();
  }

  private resizeToViewport(): void {
    if (!this.isConnected || !this.initialViewportSize) return;
    const { width, height } = this.initialViewportSize;
    const size = `${width}x${height}`;
    if (this.lastRequestedSize === size) return;
    this.lastRequestedSize = size;
    void this.sendAction({ kind: "resize", width, height }).catch((error) => {
      this.lastRequestedSize = "";
      logger.error("FE/connector/rdp/resize", "Resize failed", { error });
    });
  }

  protected cleanupListeners(): void {
    super.cleanupListeners();
    this.eventHandlers.clear();
    this.latestCursor = null;
    this.lastRequestedSize = "";
  }

  setInitialViewportSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      return;
    }

    this.initialViewportSize = {
      width: Math.min(8192, Math.max(200, Math.floor(width))) & ~1,
      height: Math.min(8192, Math.max(200, Math.floor(height))),
    };
    this.resolveInitialViewport?.();
    this.resolveInitialViewport = null;
    if (this.initialViewportLocked) this.resizeToViewport();
  }

  applyQualityPolicy(policy: ConnectionQualityPolicy): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    invokeTauri(
      "set_rdp_quality_policy",
      { sessionId: this.sessionId, policy },
      { scope: "FE/connector/rdp/quality" },
    ).catch((error) => {
      logger.error("FE/connector/rdp/quality", "Applying quality policy failed", error);
    });
  }

  requestFrame(): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    invokeTauri(
      "request_rdp_refresh",
      { sessionId: this.sessionId },
      { scope: "FE/connector/rdp/refresh" },
    ).catch((error) => {
      logger.error("FE/connector/rdp/refresh", "Refresh request failed", error);
    });
  }

  protected buildCreateSessionArgs(): Record<string, unknown> {
    const initialSize = this.initialViewportSize ?? {
      width: this.config.width,
      height: this.config.height,
    };

    return {
      sessionId: this.requestedSessionId,
      config: {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        domain: this.config.domain,
        width: initialSize.width,
        height: initialSize.height,
      },
      frameChannel: this.frameChannel,
      eventChannel: this.eventChannel,
    };
  }

  protected getRequestedSessionId(): string {
    return this.requestedSessionId;
  }

  protected async prepareProtocolListeners(): Promise<void> {
    let timeoutId: number | undefined;
    try {
      await Promise.race([
        this.initialViewportReady,
        new Promise<void>((resolve) => {
          timeoutId = window.setTimeout(resolve, 300);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      this.initialViewportLocked = true;
    }
  }

  protected extractFrameSize(frame: RdpFramePayload): { width: number; height: number } {
    return {
      width: frame.desktopWidth,
      height: frame.desktopHeight,
    };
  }

  private static parseFramePacket(packet: ArrayBuffer): RdpFramePayload {
    const view = new DataView(packet);
    const desktopWidth = view.getUint16(0, true);
    const desktopHeight = view.getUint16(2, true);
    const regionLeft = view.getUint16(4, true);
    const regionTop = view.getUint16(6, true);
    const regionWidth = view.getUint16(8, true);
    const regionHeight = view.getUint16(10, true);
    const flags = view.getUint8(12);
    const fullFrame = (flags & 0x01) === 0x01;
    const encoding = (flags & 0x02) === 0x02 ? "rgba" : "jpeg";
    const imageBytes = packet.slice(BaseGraphicalConnector.FRAME_HEADER_SIZE);

    return {
      desktopWidth,
      desktopHeight,
      regionLeft,
      regionTop,
      regionWidth,
      regionHeight,
      fullFrame,
      encoding,
      imageBytes,
    };
  }
}
