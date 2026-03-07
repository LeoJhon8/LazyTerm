import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ITerminalConnector, SSHConfig } from "@/types/terminal";

export class SshConnector implements ITerminalConnector {
  readonly protocol = "ssh" as const;
  private config: SSHConfig;
  private unlistenFn: UnlistenFn | null = null;
  private sessionId: string | null = null;
  private onDisconnectCallback?: () => void;

  constructor(config: SSHConfig, onDisconnect?: () => void) {
    this.config = config;
    this.onDisconnectCallback = onDisconnect;
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
    if (this.isConnected) {
      throw new Error("SSH 连接已建立");
    }

    try {
      // 调用 Tauri 后端创建 SSH 会话
      this.sessionId = await invoke<string>("create_ssh_session", {
        config: {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.authType === "password" ? this.config.password : undefined,
          private_key_path: this.config.authType === "privateKey" ? this.config.privateKeyPath : undefined,
          keep_alive: this.config.keepAlive,
          ready_timeout: this.config.readyTimeout,
        },
      });

      console.log(`[SSH] 成功连接到 ${this.config.host}:${this.config.port}`);
    } catch (error) {
      console.error("[SSH] 连接失败:", error);
      throw error;
    }
  }

  close(): void {
    if (!this.sessionId) return;

    try {
      // 调用后端关闭 SSH 会话
      invoke("close_ssh_session", { sessionId: this.sessionId }).catch((err) => {
        console.error("[SSH] 关闭会话失败:", err);
      });
    } catch (error) {
      console.error("[SSH] 关闭连接时出错:", error);
    } finally {
      // 取消事件监听
      if (this.unlistenFn) {
        this.unlistenFn();
        this.unlistenFn = null;
      }
      
      this.sessionId = null;
    }
  }

  setOnDisconnect(callback: () => void): void {
    this.onDisconnectCallback = callback;
  }

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

    const eventName = `terminal-data-${this.sessionId}`;
    console.log(`[SSH Connector] Listening for event: ${eventName}`);
    
    // 监听属于这个 sessionId 的数据事件
    this.unlistenFn = await listen<string>(eventName, (event) => {
      console.log(`[SSH Connector] Received event payload:`, event.payload?.substring(0, 50));
      handler(event.payload);
    });
    
    console.log(`[SSH Connector] Event listener registered`);
    
    // 监听 SSH 连接断开事件（当后端关闭连接时）
    const closeEventName = `terminal-close-${this.sessionId}`;
    const closeUnlisten = await listen(closeEventName, () => {
      console.log(`[SSH Connector] Connection closed event received`);
      this.handleDisconnect();
    });
    
    // 存储关闭事件的 unlisten 函数
    const originalUnlistenFn = this.unlistenFn;
    this.unlistenFn = () => {
      if (originalUnlistenFn) originalUnlistenFn();
      closeUnlisten();
    };
  }

  private handleDisconnect(): void {
    console.log('[SSH Connector] Handling disconnection...');
    this.sessionId = null;
    if (this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
  }

  write(data: string | Uint8Array): void {
    if (!this.sessionId) return;

    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    
    invoke("write_to_ssh_session", {
      sessionId: this.sessionId,
      data: text,
    }).catch((err) => {
      console.error("[SSH] 写入失败:", err);
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.sessionId) return;

    invoke("resize_ssh_session", {
      sessionId: this.sessionId,
      cols,
      rows,
    }).catch((err) => {
      console.error("[SSH] 调整大小失败:", err);
    });
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getConfig(): SSHConfig {
    return this.config;
  }
}
