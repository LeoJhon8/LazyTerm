import type { ITerminalConnector, TelnetConfig } from "@/types/terminal";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground } from "@/services/tauri";

export class TelnetConnector implements ITerminalConnector {
  public readonly protocol = 'telnet' as const;
  private config: TelnetConfig;
  private unlistenFn: UnlistenFn | null = null;
  private sessionId: string | null = null;
  private onDisconnectCallback?: () => void;

  constructor(config: TelnetConfig, onDisconnect?: () => void) {
    this.config = config;
    this.onDisconnectCallback = onDisconnect;
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
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
    } catch (error) {
      logger.error("FE/connector/telnet/open", "Failed to open telnet connection via Rust", error);
      throw error;
    }
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
    
    const dataStr = typeof data === 'string' ? data : new TextDecoder().decode(data);
    
    invokeTauri("write_telnet", {
      sessionId: this.sessionId, 
      data: dataStr 
    }, {
      scope: "FE/connector/telnet/write",
    }).catch((error) => {
      logger.error("FE/connector/telnet/write", "Write failed", error);
      this.handleDisconnect();
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
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
    this.onDisconnectCallback?.();
  }
}
