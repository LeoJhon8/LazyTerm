import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  IVncConnector,
  ConnectionQualityPolicy,
  VNCConfig,
  VncCursorPayload,
  VncFramePayload,
  VncKeyboardPayload,
  VncKeySequencePayload,
  VncPointerPayload,
} from "@/types/terminal";
import { logger } from "@/lib/logger";
import { invokeTauri } from "@/services/tauri";
import { BaseGraphicalConnector } from "./BaseGraphicalConnector";

export class VncConnector
  extends BaseGraphicalConnector<VNCConfig, VncFramePayload, VncPointerPayload, VncKeyboardPayload>
  implements IVncConnector
{
  readonly protocol = "vnc" as const;
  private readonly requestedSessionId = crypto.randomUUID();
  private lastResize: { sessionId: string; width: number; height: number } | null = null;

  private cursorUnlisten: UnlistenFn | null = null;
  private cursorHandler: ((cursor: VncCursorPayload) => void) | null = null;
  private latestCursor: VncCursorPayload | null = null;
  private clipboardUnlisten: UnlistenFn | null = null;
  private clipboardHandler: ((text: string) => void) | null = null;
  private latestClipboard: string | null = null;
  private sessionListenersPromise: Promise<void> | null = null;

  constructor(config: VNCConfig) {
    super(
      config,
      "vnc",
      "create_vnc_session",
      "close_vnc_session",
      "vnc-close",
      VncConnector.parseFramePacket,
    );
  }

  async onFrame(handler: (frame: VncFramePayload) => void): Promise<void> {
    await super.onFrame(handler);
  }

  async onCursor(handler: (cursor: VncCursorPayload) => void): Promise<void> {
    await this.ensureSessionListeners(this.requestedSessionId);
    await this.waitUntilUsable();
    this.cursorHandler = handler;

    if (this.latestCursor) {
      handler(this.latestCursor);
    }
  }

  async onClipboard(handler: (text: string) => void): Promise<void> {
    await this.ensureSessionListeners(this.requestedSessionId);
    await this.waitUntilUsable();
    this.clipboardHandler = handler;
    if (this.latestClipboard !== null) {
      handler(this.latestClipboard);
    }
  }

  sendPointer(payload: VncPointerPayload): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    invokeTauri(
      "send_vnc_pointer",
      { sessionId: this.sessionId, payload },
      { scope: "FE/connector/vnc/pointer" },
    ).catch((error) => {
      logger.error("FE/connector/vnc/pointer", "Pointer input failed", { error });
    });
  }

  sendKey(payload: VncKeyboardPayload): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    invokeTauri(
      "send_vnc_key",
      { sessionId: this.sessionId, payload },
      { scope: "FE/connector/vnc/key" },
    ).catch((error) => {
      logger.error("FE/connector/vnc/key", "Keyboard input failed", { error });
    });
  }

  sendKeySequence(payload: VncKeySequencePayload): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    invokeTauri(
      "send_vnc_key_sequence",
      { sessionId: this.sessionId, payload },
      { scope: "FE/connector/vnc/key-sequence" },
    ).catch((error) => {
      logger.error("FE/connector/vnc/key-sequence", "Keyboard sequence input failed", { error });
    });
  }

  async pasteClipboard(text: string, keySym: number, modifierKeySyms: number[]): Promise<void> {
    const sessionId = await this.waitForSessionId();
    await invokeTauri(
      "paste_vnc_clipboard",
      {
        sessionId,
        payload: {
          text,
          keySym,
          modifierKeySyms,
        },
      },
      { scope: "FE/connector/vnc/clipboard" },
    );
  }

  async typeText(text: string, modifierKeySyms: number[]): Promise<void> {
    const sessionId = await this.waitForSessionId();
    await invokeTauri(
      "type_vnc_text",
      {
        sessionId,
        payload: { text, modifierKeySyms },
      },
      { scope: "FE/connector/vnc/type-text" },
    );
  }

  requestFrame(full = false): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    invokeTauri(
      "request_vnc_refresh",
      { sessionId: this.sessionId, full },
      { scope: "FE/connector/vnc/refresh" },
    ).catch((error) => {
      logger.error("FE/connector/vnc/refresh", "Refresh request failed", { error });
    });
  }

  resize(width: number, height: number): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    const sessionId = this.sessionId;
    const normalizedWidth = Math.max(1, Math.floor(width));
    const normalizedHeight = Math.max(1, Math.floor(height));
    if (
      this.lastResize?.sessionId === sessionId
      && this.lastResize.width === normalizedWidth
      && this.lastResize.height === normalizedHeight
    ) {
      return;
    }
    const request = {
      sessionId,
      width: normalizedWidth,
      height: normalizedHeight,
    };
    this.lastResize = request;

    invokeTauri(
      "resize_vnc_session",
      request,
      { scope: "FE/connector/vnc/resize" },
    ).catch((error) => {
      logger.error("FE/connector/vnc/resize", "Desktop resize request failed", { error });
      if (this.lastResize === request) {
        this.lastResize = null;
      }
    });
  }

  applyQualityPolicy(policy: ConnectionQualityPolicy): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    invokeTauri(
      "set_vnc_quality_policy",
      { sessionId: this.sessionId, policy },
      { scope: "FE/connector/vnc/quality" },
    ).catch((error) => {
      logger.error("FE/connector/vnc/quality", "Applying quality policy failed", { error });
    });
  }

  close(): void {
    this.lastResize = null;
    super.close();
    this.cleanupVncListeners();
  }

  protected buildCreateSessionArgs(): Record<string, unknown> {
    return {
      sessionId: this.requestedSessionId,
      config: {
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        shared: this.config.shared ?? true,
        viewOnly: this.config.viewOnly ?? false,
        allowJpeg: this.config.allowJpeg ?? true,
        quality: this.config.quality ?? 30,
      },
      frameChannel: this.frameChannel,
    };
  }

  protected getRequestedSessionId(): string {
    return this.requestedSessionId;
  }

  protected async prepareProtocolListeners(sessionId: string): Promise<void> {
    await this.ensureSessionListeners(sessionId);
  }

  protected handleFrameParseError(error: unknown): void {
    super.handleFrameParseError(error);
    this.requestFrame(true);
  }

  protected extractFrameSize(frame: VncFramePayload): { width: number; height: number } {
    return {
      width: frame.desktopWidth,
      height: frame.desktopHeight,
    };
  }

  protected cleanupListeners(): void {
    super.cleanupListeners();
    this.cleanupVncListeners();
    this.cursorHandler = null;
    this.clipboardHandler = null;
    this.latestCursor = null;
    this.latestClipboard = null;
  }

  private cleanupVncListeners(): void {
    if (this.cursorUnlisten) {
      this.cursorUnlisten();
      this.cursorUnlisten = null;
    }
    if (this.clipboardUnlisten) {
      this.clipboardUnlisten();
      this.clipboardUnlisten = null;
    }
    this.sessionListenersPromise = null;
  }

  private async ensureSessionListeners(sessionId: string): Promise<void> {
    if (!this.sessionListenersPromise) {
      this.sessionListenersPromise = this.setupSessionListeners(sessionId).catch((error) => {
        this.sessionListenersPromise = null;
        throw error;
      });
    }
    await this.sessionListenersPromise;
  }

  private async setupSessionListeners(sessionId: string): Promise<void> {
    let cursorUnlisten: UnlistenFn | null = null;
    let clipboardUnlisten: UnlistenFn | null = null;
    try {
      cursorUnlisten = await listen<{
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

      clipboardUnlisten = await listen<string>(`vnc-clipboard-${sessionId}`, (event) => {
        this.latestClipboard = event.payload;
        this.clipboardHandler?.(event.payload);
      });
      if (this.isConnectionClosed()) {
        throw new Error("VNC connection closed while event listeners were registering");
      }
      this.cursorUnlisten = cursorUnlisten;
      this.clipboardUnlisten = clipboardUnlisten;
    } catch (error) {
      cursorUnlisten?.();
      clipboardUnlisten?.();
      throw error;
    }
  }

  private static parseFramePacket(packet: ArrayBuffer): VncFramePayload {
    const headerSize = BaseGraphicalConnector.FRAME_HEADER_SIZE;
    if (packet.byteLength < headerSize) {
      throw new Error(`VNC frame packet is shorter than ${headerSize} bytes`);
    }

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
    const imageBytes = packet.slice(headerSize);

    const desktopPixels = desktopWidth * desktopHeight;
    const regionRight = regionLeft + regionWidth;
    const regionBottom = regionTop + regionHeight;
    if (
      desktopWidth === 0
      || desktopHeight === 0
      || desktopWidth > 8192
      || desktopHeight > 8192
      || desktopPixels > 32 * 1024 * 1024
      || regionWidth === 0
      || regionHeight === 0
      || regionRight > desktopWidth
      || regionBottom > desktopHeight
      || imageBytes.byteLength === 0
      || imageBytes.byteLength > 128 * 1024 * 1024
    ) {
      throw new Error("VNC frame packet contains invalid geometry or payload size");
    }
    if (isRgba && imageBytes.byteLength !== regionWidth * regionHeight * 4) {
      throw new Error("VNC RGBA frame packet length does not match its region");
    }

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
