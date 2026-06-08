import type {
  IRdpConnector,
  RDPConfig,
  RdpFramePayload,
  RdpKeyboardPayload,
  RdpPointerPayload,
} from "@/types/terminal";
import { logger } from "@/lib/logger";
import { invokeTauri } from "@/services/tauri";
import { BaseGraphicalConnector } from "./BaseGraphicalConnector";

export class RdpConnector
  extends BaseGraphicalConnector<RDPConfig, RdpFramePayload, RdpPointerPayload, RdpKeyboardPayload>
  implements IRdpConnector
{
  readonly protocol = "rdp" as const;
  readonly backend = "freerdp" as const;

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
    if (!this.sessionId) {
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
    if (!this.sessionId) {
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
    if (!this.sessionId) {
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

  resize(width: number, height: number): void {
    if (!this.sessionId) {
      return;
    }

    invokeTauri(
      "resize_rdp_session",
      { sessionId: this.sessionId, width, height },
      { scope: "FE/connector/rdp/resize" },
    ).catch((error) => {
      logger.error("FE/connector/rdp/resize", "Resize failed", error);
    });
  }

  requestFrame(): void {
    if (!this.sessionId) {
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
    return {
      config: {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        domain: this.config.domain,
        width: this.config.width,
        height: this.config.height,
        auto_resize: this.config.autoResize ?? false,
      },
      frameChannel: this.frameChannel,
    };
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
