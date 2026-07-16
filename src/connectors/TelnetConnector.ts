import type { ConnectionStateEvent, ITerminalConnector, TelnetConfig } from "@/types/terminal";
import { ConnectionStateEmitter } from "./ConnectionStateEmitter";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground, invokeTauriSerialized } from "@/services/tauri";

export class TelnetConnector implements ITerminalConnector {
  public readonly protocol = 'telnet' as const;
  private config: TelnetConfig;
  private unlistenFn: UnlistenFn | null = null;
  private sessionId: string | null = null;
  private readonly stateEmitter = new ConnectionStateEmitter("FE/connector/telnet/state");

  constructor(config: TelnetConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
    this.stateEmitter.emit({ phase: "connecting" });
    try {
      this.sessionId = `telnet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      await invokeTauri("open_telnet_session", {
        sessionId: this.sessionId,
        config: this.config
      }, {
        scope: "FE/connector/telnet/open",
        logStart: true,
        logSuccess: true,
      });
      this.stateEmitter.emit({ phase: "connected" });
    } catch (error) {
      this.sessionId = null;
      logger.error("FE/connector/telnet/open", "Failed to open telnet connection via Rust", error);
      this.stateEmitter.emit({ phase: "failed", reason: "Telnet 连接失败", technicalDetails: String(error) });
      throw error;
    }
  }

  onConnectionState(handler: (event: ConnectionStateEvent) => void): () => void {
    return this.stateEmitter.subscribe(handler);
  }

  async onData(handler: (data: string) => void): Promise<void> {
    if (this.unlistenFn) {
      try {
        this.unlistenFn();
      } catch (e) {
        logger.warn("FE/connector/telnet/listen", "Failed to unlisten previous listeners", e);
      }
      this.unlistenFn = null;
    }

    if (!this.sessionId) {
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
    const dataEventName = `telnet-data-${sessionId}`;
    const closeEventName = `telnet-close-${sessionId}`;

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
    
    const sessionId = this.sessionId;
    const dataStr = typeof data === 'string' ? data : new TextDecoder().decode(data);
    
    invokeTauriSerialized(`telnet:${sessionId}:write`, "write_telnet", {
      sessionId,
      data: dataStr 
    }, {
      scope: "FE/connector/telnet/write",
    }).catch((error) => {
      logger.error("FE/connector/telnet/write", "Write failed", error);
      if (this.sessionId === sessionId) {
        this.handleDisconnect();
      }
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.sessionId) return;
    
    invokeTauri("resize_telnet", {
      sessionId: this.sessionId, 
      cols, 
      rows 
    }, {
      scope: "FE/connector/telnet/resize",
    }).catch((error) => {
      logger.error("FE/connector/telnet/resize", "Resize failed", error);
    });
  }

  close(): void {
    this.stateEmitter.emit({ phase: "closing" });
    if (this.sessionId) {
      invokeTauriBackground("close_telnet", { sessionId: this.sessionId }, { scope: "FE/connector/telnet/close" });
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
    this.stateEmitter.emit({ phase: "disconnected", reason: "Telnet 连接已断开" });
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
  }
}
