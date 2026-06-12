import type { ConnectionStateEvent, ITerminalConnector, SerialConfig } from "@/types/terminal";
import { ConnectionStateEmitter } from "./ConnectionStateEmitter";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground } from "@/services/tauri";

export class SerialConnector implements ITerminalConnector {
  public readonly protocol = 'serial' as const;
  private config: SerialConfig;
  private unlistenFn: UnlistenFn | null = null;
  private sessionId: string | null = null;
  private readonly stateEmitter = new ConnectionStateEmitter("FE/connector/serial/state");

  constructor(config: SerialConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
    this.stateEmitter.emit({ phase: "connecting" });
    try {
      this.sessionId = `serial-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      await invokeTauri("open_serial_session", {
        sessionId: this.sessionId,
        config: this.config
      }, {
        scope: "FE/connector/serial/open",
        logStart: true,
        logSuccess: true,
      });
      this.stateEmitter.emit({ phase: "connected" });
    } catch (error) {
      this.sessionId = null;
      logger.error("FE/connector/serial/open", "Failed to open serial port via Rust", error);
      this.stateEmitter.emit({ phase: "failed", reason: "串口连接失败", technicalDetails: String(error) });
      throw error;
    }
  }

  onConnectionState(handler: (event: ConnectionStateEvent) => void): () => void {
    return this.stateEmitter.subscribe(handler);
  }

  async onData(handler: (data: string) => void): Promise<void> {
    if (!this.sessionId) {
      // Loop to wait for sessionId
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.sessionId) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 10);
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 5000);
      });
      
      if (!this.sessionId) throw new Error("Session ID not available after timeout");
    }

    const sessionId = this.sessionId;
    const dataEventName = `serial-data-${sessionId}`;
    const closeEventName = `serial-close-${sessionId}`;

    const dataUnlisten = await listen<string>(dataEventName, (event) => {
      handler(event.payload);
    });

    const closeUnlisten = await listen(closeEventName, () => {
      this.handleDisconnect();
    });

    this.unlistenFn = () => {
      dataUnlisten();
      closeUnlisten();
    };
  }

  write(data: string | Uint8Array): void {
    if (!this.sessionId) return;
    
    const dataStr = typeof data === 'string' ? data : new TextDecoder().decode(data);
    
    invokeTauri("write_serial", {
      sessionId: this.sessionId, 
      data: dataStr 
    }, {
      scope: "FE/connector/serial/write",
    }).catch((error) => {
      logger.error("FE/connector/serial/write", "Write failed", error);
      this.handleDisconnect();
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.sessionId) return;
    
    invokeTauri("resize_serial", {
      sessionId: this.sessionId, 
      cols, 
      rows 
    }, {
      scope: "FE/connector/serial/resize",
    }).catch((error) => {
      logger.error("FE/connector/serial/resize", "Resize failed", error);
    });
  }

  close(): void {
    this.stateEmitter.emit({ phase: "closing" });
    if (this.sessionId) {
      invokeTauriBackground("close_serial", { sessionId: this.sessionId }, { scope: "FE/connector/serial/close" });
      this.sessionId = null;
    }
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
  }

  private handleDisconnect(): void {
    if (!this.sessionId) return;
    this.sessionId = null;
    this.stateEmitter.emit({ phase: "disconnected", reason: "串口连接已断开" });
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
  }
}
