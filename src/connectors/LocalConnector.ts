import type { ConnectionStateEvent, ITerminalConnector } from "@/types/terminal";
import { ConnectionStateEmitter } from "./ConnectionStateEmitter";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground, invokeTauriSerialized } from "@/services/tauri";

export class LocalConnector implements ITerminalConnector {
  public readonly protocol = 'local' as const;
  private config: { cwd?: string; shell?: string; admin?: boolean };
  private unlistenFn: UnlistenFn | null = null;
  private sessionId: string | null = null;
  private readonly stateEmitter = new ConnectionStateEmitter("FE/connector/local/state");

  constructor(config: { cwd?: string; shell?: string; admin?: boolean }) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
    this.stateEmitter.emit({ phase: "connecting" });
    try {
      // 1. 调用 Rust 创建 PTY 进程，并返回一个唯一的会话 ID
      this.sessionId = await invokeTauri<string>("create_terminal", {
        cwd: this.config.cwd,
        shell: this.config.shell,
        admin: this.config.admin
      }, {
        scope: "FE/connector/local/open",
        logStart: true,
        logSuccess: true,
      });
      this.stateEmitter.emit({ phase: "connected" });
    } catch (error) {
      logger.error("FE/connector/local/open", "Failed to spawn terminal via Rust", error);
      this.stateEmitter.emit({ phase: "failed", reason: "本地终端启动失败", technicalDetails: String(error) });
      throw error;
    }
  }

  onConnectionState(handler: (event: ConnectionStateEvent) => void): () => void {
    return this.stateEmitter.subscribe(handler);
  }

  // 修改 onData 以监听来自 Rust 的事件
  async onData(handler: (data: string) => void): Promise<void> {
    // 等待 sessionId 可用
    if (!this.sessionId) {
      // 轮询等待 sessionId 被设置（open() 完成后）
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.sessionId) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 10);
        
        // 5 秒超时
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 5000);
      });
      
      if (!this.sessionId) {
        throw new Error("Session ID not available after timeout");
      }
    }

    const sessionId = this.sessionId;
    const dataEventName = `terminal-data-${sessionId}`;
    const closeEventName = `terminal-close-${sessionId}`;

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
    
    // 3. 将输入发送给 Rust
    invokeTauriSerialized(`local:${sessionId}:write`, "write_to_terminal", {
      sessionId,
      data: dataStr 
    }, {
      scope: "FE/connector/local/write",
    }).catch((error) => {
      logger.error("FE/connector/local/write", "Write failed", error);
      if (this.sessionId === sessionId) {
        this.handleDisconnect();
      }
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.sessionId) return;
    
    // 4. 通知 Rust 调整大小
    invokeTauri("resize_terminal", {
      sessionId: this.sessionId, 
      cols, 
      rows 
    }, {
      scope: "FE/connector/local/resize",
    }).catch((error) => {
      logger.error("FE/connector/local/resize", "Resize failed", error);
      this.handleDisconnect();
    });
  }

  close(): void {
    this.stateEmitter.emit({ phase: "closing" });
    if (this.sessionId) {
      invokeTauriBackground("close_terminal", { sessionId: this.sessionId }, { scope: "FE/connector/local/close" });
      this.sessionId = null;
    }
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
  }

  private handleDisconnect(): void {
    if (!this.sessionId) {
      return;
    }

    this.sessionId = null;
    this.stateEmitter.emit({ phase: "disconnected", reason: "本地终端进程已退出" });

    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }

  }
}
