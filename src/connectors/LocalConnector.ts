import type { ITerminalConnector } from "@/types/terminal";
import { invoke } from "@tauri-apps/api/core"; // Tauri v2 路径，v1 请用 @tauri-apps/api/tauri
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export class LocalConnector implements ITerminalConnector {
  public readonly protocol = 'local' as const;
  private config: { cwd?: string; shell?: string; admin?: boolean };
  private unlistenFn: UnlistenFn | null = null;
  private sessionId: string | null = null;
  private onDisconnectCallback?: () => void;

  constructor(config: { cwd?: string; shell?: string; admin?: boolean }, onDisconnect?: () => void) {
    this.config = config;
    this.onDisconnectCallback = onDisconnect;
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
    try {
      // 1. 调用 Rust 创建 PTY 进程，并返回一个唯一的会话 ID
      this.sessionId = await invoke<string>("create_terminal", {
        cwd: this.config.cwd,
        shell: this.config.shell,
        admin: this.config.admin
      });
    } catch (error) {
      console.error("Failed to spawn terminal via Rust:", error);
      throw error;
    }
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
    
    const dataStr = typeof data === 'string' ? data : new TextDecoder().decode(data);
    
    // 3. 将输入发送给 Rust
    invoke("write_to_terminal", { 
      sessionId: this.sessionId, 
      data: dataStr 
    }).catch((error) => {
      console.error(error);
      this.handleDisconnect();
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.sessionId) return;
    
    // 4. 通知 Rust 调整大小
    invoke("resize_terminal", { 
      sessionId: this.sessionId, 
      cols, 
      rows 
    }).catch((error) => {
      console.error(error);
      this.handleDisconnect();
    });
  }

  close(): void {
    if (this.sessionId) {
      invoke("close_terminal", { sessionId: this.sessionId }).catch(console.error);
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

    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }

    this.onDisconnectCallback?.();
  }
}