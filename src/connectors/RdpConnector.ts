import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  IRdpConnector,
  RDPConfig,
  RdpFramePayload,
  RdpKeyboardPayload,
  RdpPointerPayload,
} from "@/types/terminal";

export class RdpConnector implements IRdpConnector {
  readonly protocol = "rdp" as const;
  readonly backend = "ironrdp" as const;
  private static readonly FRAME_HEADER_SIZE = 13;

  private readonly config: RDPConfig;
  private readonly frameChannel: Channel<ArrayBuffer>;
  private sessionId: string | null = null;
  private connectPromise: Promise<string> | null = null;
  private closedBeforeConnect = false;
  private closeUnlisten: UnlistenFn | null = null;
  private closeHandlers = new Set<() => void>();
  private frameHandler: ((frame: RdpFramePayload) => void) | null = null;
  private frameSize: { width: number; height: number } | null = null;
  private latestFrame: RdpFramePayload | null = null;

  constructor(config: RDPConfig) {
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
      this.connectPromise = invoke<string>("create_rdp_session", {
        config: {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.password,
          domain: this.config.domain,
          width: this.config.width,
          height: this.config.height,
          auto_resize: this.config.autoResize ?? true,
        },
        frameChannel: this.frameChannel,
      }).then((sessionId) => {
        if (this.closedBeforeConnect) {
          invoke("close_rdp_session", {
            sessionId,
          }).catch((error) => {
            console.error("[RDP] Close-after-connect failed:", error);
          });
          throw new Error("RDP connection was closed before initialization completed");
        }

        this.sessionId = sessionId;
        return sessionId;
      }).finally(() => {
        this.connectPromise = null;
      });
    }

    await this.connectPromise;
  }

  async onFrame(handler: (frame: RdpFramePayload) => void): Promise<void> {
    const sessionId = await this.waitForSessionId();

    this.frameHandler = handler;
    this.closeUnlisten?.();

    this.closeUnlisten = await listen(`rdp-close-${sessionId}`, () => {
      this.handleDisconnect();
    });

    if (this.latestFrame) {
      handler(this.latestFrame);
    }
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  sendPointer(payload: RdpPointerPayload): void {
    if (!this.sessionId) {
      return;
    }

    invoke("send_rdp_pointer", {
      sessionId: this.sessionId,
      payload,
    }).catch((error) => {
      console.error("[RDP] Pointer input failed:", error);
    });
  }

  sendKey(payload: RdpKeyboardPayload): void {
    if (!this.sessionId) {
      return;
    }

    invoke("send_rdp_key", {
      sessionId: this.sessionId,
      payload,
    }).catch((error) => {
      console.error("[RDP] Keyboard input failed:", error);
    });
  }

  releaseInputs(): void {
    if (!this.sessionId) {
      return;
    }

    invoke("release_rdp_inputs", {
      sessionId: this.sessionId,
    }).catch((error) => {
      console.error("[RDP] Releasing inputs failed:", error);
    });
  }

  resize(width: number, height: number): void {
    if (!this.sessionId) {
      return;
    }

    invoke("resize_rdp_session", {
      sessionId: this.sessionId,
      width,
      height,
    }).catch((error) => {
      console.error("[RDP] Resize failed:", error);
    });
  }

  getFrameSize(): { width: number; height: number } | null {
    return this.frameSize;
  }

  close(): void {
    this.closedBeforeConnect = true;

    if (this.sessionId) {
      invoke("close_rdp_session", {
        sessionId: this.sessionId,
      }).catch((error) => {
        console.error("[RDP] Close failed:", error);
      });
    }

    this.cleanupListeners();
    this.sessionId = null;
  }

  private parseFramePacket(packet: ArrayBuffer): RdpFramePayload {
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
    const imageBytes = packet.slice(RdpConnector.FRAME_HEADER_SIZE);

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

    throw new Error("RDP session has not started opening yet");
  }

  private handleDisconnect(): void {
    if (!this.sessionId) {
      return;
    }

    this.cleanupListeners();
    this.latestFrame = null;
    this.sessionId = null;
    this.closeHandlers.forEach((handler) => handler());
  }

  private cleanupListeners(): void {
    if (this.closeUnlisten) {
      this.closeUnlisten();
      this.closeUnlisten = null;
    }

    this.frameHandler = null;
  }
}