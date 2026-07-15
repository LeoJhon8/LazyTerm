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
import { invokeTauri } from "@/services/tauri";
import { BaseGraphicalConnector } from "./BaseGraphicalConnector";

export class VncConnector
  extends BaseGraphicalConnector<VNCConfig, VncFramePayload, VncPointerPayload, VncKeyboardPayload>
  implements IVncConnector
{
  readonly protocol = "vnc" as const;

  private cursorUnlisten: UnlistenFn | null = null;
  private cursorHandler: ((cursor: VncCursorPayload) => void) | null = null;
  private latestCursor: VncCursorPayload | null = null;
  private clipboardUnlisten: UnlistenFn | null = null;
  private clipboardHandler: ((text: string) => void) | null = null;
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
    // VNC 特有的：确保监听器已设置（包括光标）
    const sessionId = await this.waitForSessionId();
    await this.ensureSessionListeners(sessionId);
  }

  async onCursor(handler: (cursor: VncCursorPayload) => void): Promise<void> {
    const sessionId = await this.waitForSessionId();

    this.cursorHandler = handler;
    await this.ensureSessionListeners(sessionId);

    if (this.latestCursor) {
      handler(this.latestCursor);
    }
  }

  async onClipboard(handler: (text: string) => void): Promise<void> {
    const sessionId = await this.waitForSessionId();

    this.clipboardHandler = handler;
    await this.ensureSessionListeners(sessionId);
  }

  sendPointer(payload: VncPointerPayload): void {
    if (!this.sessionId) {
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
    if (!this.sessionId) {
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

  requestFrame(full = false): void {
    if (!this.sessionId) {
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

  resize(): void {
    // VNC 暂不支持动态调整大小
    logger.debug("FE/connector/vnc/resize", "VNC resize not supported");
  }

  close(): void {
    super.close();
    this.cleanupVncListeners();
  }

  protected buildCreateSessionArgs(): Record<string, unknown> {
    return {
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
    try {
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

      this.clipboardUnlisten = await listen<string>(`vnc-clipboard-${sessionId}`, (event) => {
        this.clipboardHandler?.(event.payload);
      });
    } catch (error) {
      this.cleanupVncListeners();
      throw error;
    }
  }

  private static parseFramePacket(packet: ArrayBuffer): VncFramePayload {
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
