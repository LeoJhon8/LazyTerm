import { Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  IVncConnector,
  VNCConfig,
  VncCursorPayload,
  VncFramePayload,
  VncKeyboardPayload,
  VncPointerPayload,
} from "@/types/terminal";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground } from "@/services/tauri";

export class VncConnector implements IVncConnector {
  readonly protocol = "vnc" as const;
  private static readonly FRAME_HEADER_SIZE = 13;

  private readonly config: VNCConfig;
  private readonly frameChannel: Channel<ArrayBuffer>;
  private sessionId: string | null = null;
  private connectPromise: Promise<string> | null = null;
  private closedBeforeConnect = false;
  private closeUnlisten: UnlistenFn | null = null;
  private cursorUnlisten: UnlistenFn | null = null;
  private closeHandlers = new Set<() => void>();
  private frameHandler: ((frame: VncFramePayload) => void) | null = null;
  private cursorHandler: ((cursor: VncCursorPayload) => void) | null = null;
  private frameSize: { width: number; height: number } | null = null;
  private latestFrame: VncFramePayload | null = null;
  private latestCursor: VncCursorPayload | null = null;

  constructor(config: VNCConfig) {
    this.config = config;
    this.frameChannel = new Channel<ArrayBuffer>((packet) => {
      const frame = this.parseFramePacket(packet);
      this.frameSize = {
        width: frame.desktopWidth,
        height: frame.desktopHeight,
      };
      this.latestFrame = frame;
      this.frameHandler?.(frame);
    });
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
    if (this.sessionId) {
      return;
    }

    if (!this.connectPromise) {
      this.closedBeforeConnect = false;
      this.connectPromise = invokeTauri<string>("create_vnc_session", {
        config: {
          host: this.config.host,
          port: this.config.port,
          password: this.config.password,
          shared: this.config.shared ?? true,
          allowJpeg: this.config.allowJpeg ?? true,
        },
        frameChannel: this.frameChannel,
      }, {
        scope: "FE/connector/vnc/open",
        logStart: true,
        logSuccess: true,
      }).then((sessionId) => {
        if (this.closedBeforeConnect) {
          invokeTauriBackground("close_vnc_session", { sessionId }, { scope: "FE/connector/vnc/close" });
          throw new Error("VNC connection was closed before initialization completed");
        }

        this.sessionId = sessionId;
        return sessionId;
      }).finally(() => {
        this.connectPromise = null;
      });
    }

    await this.connectPromise;
  }

  async onFrame(handler: (frame: VncFramePayload) => void): Promise<void> {
    const sessionId = await this.waitForSessionId();

    this.frameHandler = handler;
    await this.ensureSessionListeners(sessionId);

    if (this.latestFrame) {
      handler(this.latestFrame);
    }
  }

  async onCursor(handler: (cursor: VncCursorPayload) => void): Promise<void> {
    const sessionId = await this.waitForSessionId();

    this.cursorHandler = handler;
    await this.ensureSessionListeners(sessionId);

    if (this.latestCursor) {
      handler(this.latestCursor);
    }
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  sendPointer(payload: VncPointerPayload): void {
    if (!this.sessionId) {
      return;
    }

    invokeTauri("send_vnc_pointer", {
      sessionId: this.sessionId,
      payload,
    }, {
      scope: "FE/connector/vnc/pointer",
    }).catch((error) => {
      logger.error("FE/connector/vnc/pointer", "Pointer input failed", { error });
    });
  }

  sendKey(payload: VncKeyboardPayload): void {
    if (!this.sessionId) {
      return;
    }

    invokeTauri("send_vnc_key", {
      sessionId: this.sessionId,
      payload,
    }, {
      scope: "FE/connector/vnc/key",
    }).catch((error) => {
      logger.error("FE/connector/vnc/key", "Keyboard input failed", { error });
    });
  }

  requestFrame(full = false): void {
    if (!this.sessionId) {
      return;
    }

    invokeTauri("request_vnc_refresh", {
      sessionId: this.sessionId,
      full,
    }, {
      scope: "FE/connector/vnc/refresh",
    }).catch((error) => {
      logger.error("FE/connector/vnc/refresh", "Refresh request failed", { error });
    });
  }

  getFrameSize(): { width: number; height: number } | null {
    return this.frameSize;
  }

  close(): void {
    this.closedBeforeConnect = true;

    if (this.sessionId) {
      invokeTauriBackground("close_vnc_session", {
        sessionId: this.sessionId,
      }, { scope: "FE/connector/vnc/close" });
    }

    this.cleanupListeners();
    this.sessionId = null;
  }

  private parseFramePacket(packet: ArrayBuffer): VncFramePayload {
    const view = new DataView(packet);
    const desktopWidth = view.getUint16(0, true);
    const desktopHeight = view.getUint16(2, true);
    const regionLeft = view.getUint16(4, true);
    const regionTop = view.getUint16(6, true);
    const regionWidth = view.getUint16(8, true);
    const regionHeight = view.getUint16(10, true);
    const flags = view.getUint8(12);
    const fullFrame = (flags & 0x01) === 0x01;
    const isRgba = (flags & 0x02) === 0x02;
    const isPng = (flags & 0x04) === 0x04;
    const encoding = isRgba ? "rgba" : (isPng ? "png" : "jpeg");
    const imageBytes = packet.slice(VncConnector.FRAME_HEADER_SIZE);

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

  private async waitForSessionId(): Promise<string> {
    if (this.sessionId) {
      return this.sessionId;
    }

    if (this.connectPromise) {
      return await this.connectPromise;
    }

    throw new Error("VNC session has not started opening yet");
  }

  private handleDisconnect(): void {
    if (!this.sessionId) {
      return;
    }

    this.cleanupListeners();
    this.frameSize = null;
    this.latestFrame = null;
    this.latestCursor = null;
    this.sessionId = null;
    this.closeHandlers.forEach((handler) => handler());
  }

  private async ensureSessionListeners(sessionId: string): Promise<void> {
    if (!this.closeUnlisten) {
      this.closeUnlisten = await listen(`vnc-close-${sessionId}`, () => {
        this.handleDisconnect();
      });
    }

    if (!this.cursorUnlisten) {
      this.cursorUnlisten = await listen<{
        hotspotX: number;
        hotspotY: number;
        width: number;
        height: number;
        rgbaBytes: number[];
      }>(`vnc-cursor-${sessionId}`, (event) => {
        const payload = event.payload;
        const cursor: VncCursorPayload = {
          hotspotX: payload.hotspotX,
          hotspotY: payload.hotspotY,
          width: payload.width,
          height: payload.height,
          rgbaBytes: new Uint8Array(payload.rgbaBytes),
        };
        this.latestCursor = cursor;
        this.cursorHandler?.(cursor);
      });
    }
  }

  private cleanupListeners(): void {
    if (this.closeUnlisten) {
      this.closeUnlisten();
      this.closeUnlisten = null;
    }

    if (this.cursorUnlisten) {
      this.cursorUnlisten();
      this.cursorUnlisten = null;
    }

    this.frameHandler = null;
    this.cursorHandler = null;
  }
}