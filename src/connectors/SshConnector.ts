import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ITerminalConnector, SSHConfig } from "@/types/terminal";
import { useSettingsStore } from "@/store/settings";

function estimateInitialPtySize() {
  if (typeof window === "undefined") {
    return { cols: 80, rows: 24 };
  }

  const { fontFamily, fontSize } = useSettingsStore.getState();
  const terminalContainer = document.querySelector<HTMLElement>(".terminal-container");
  const containerWidth = terminalContainer?.clientWidth ?? Math.max(window.innerWidth, 800);
  const containerHeight = terminalContainer?.clientHeight ?? Math.max(window.innerHeight, 600);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  let cellWidth = 9;
  let cellHeight = 18;

  if (context) {
    context.font = `${fontSize}px ${fontFamily}`;
    const measured = context.measureText("W").width;
    if (Number.isFinite(measured) && measured > 0) {
      cellWidth = measured;
    }
    cellHeight = fontSize * 1.2;
  }

  const cols = Math.max(40, Math.floor(containerWidth / Math.max(cellWidth, 1)));
  const rows = Math.max(12, Math.floor(containerHeight / Math.max(cellHeight, 1)));

  return { cols, rows };
}

export class SshConnector implements ITerminalConnector {
  readonly protocol = "ssh" as const;
  private config: SSHConfig;
  private unlistenFn: UnlistenFn | null = null;
  private sessionId: string | null = null;
  private onDisconnectCallback?: () => void;

  // 已移除： buffer 和 flushTimer （信任前端 xterm 的队列）

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
      const initialSize = estimateInitialPtySize();

      this.sessionId = await invoke<string>("create_ssh_session", {
        config: {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.authType === "password" ? this.config.password : undefined,
          private_key_path: this.config.authType === "privateKey" ? this.config.privateKeyPath : undefined,
          keep_alive: this.config.keepAlive,
          ready_timeout: this.config.readyTimeout,
          initial_cols: initialSize.cols,
          initial_rows: initialSize.rows,
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
      invoke("close_ssh_session", { sessionId: this.sessionId }).catch((err) => {
        console.error("[SSH] 关闭会话失败:", err);
      });
    } catch (error) {
      console.error("[SSH] 关闭连接时出错:", error);
    } finally {
      if (this.unlistenFn) {
        try {
          this.unlistenFn();
        } catch (error) {
          console.warn("[SSH] 取消事件监听失败:", error);
        }
        this.unlistenFn = null;
      }
      this.sessionId = null;
    }
  }

  setOnDisconnect(callback: () => void): void {
    this.onDisconnectCallback = callback;
  }

  async onData(handler: (data: string) => void): Promise<void> {
    if (!this.sessionId) {
      await new Promise<void>((resolve, reject) => {
        let attempts = 0;
        const checkInterval = setInterval(() => {
          attempts++;
          if (this.sessionId) {
            clearInterval(checkInterval);
            resolve();
          } else if (attempts >= 500) { // 5秒超时
            clearInterval(checkInterval);
            reject(new Error("Session ID not available after timeout"));
          }
        }, 10);
      });
    }

    const eventName = `terminal-data-${this.sessionId}`;
    console.log(`[SSH Connector] Listening for event: ${eventName}`);
    
    // 直接将数据传递给 handler，不要使用 setTimeout 或者合并数组，xterm 底层具备极好的缓冲机制
    this.unlistenFn = await listen<string>(eventName, (event) => {
      const data = event.payload;
      if (data) handler(data);
    });
    
    console.log(`[SSH Connector] Event listener registered`);
    
    const closeEventName = `terminal-close-${this.sessionId}`;
    const closeUnlisten = await listen(closeEventName, () => {
      console.log(`[SSH Connector] Connection closed event received`);
      this.handleDisconnect();
    });
    
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