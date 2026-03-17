import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ITerminalConnector, SSHConfig } from "@/types/terminal";
import { useSettingsStore } from "@/store/settings";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground } from "@/services/tauri";

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

      this.sessionId = await invokeTauri<string>("create_ssh_session", {
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
      }, {
        scope: "FE/connector/ssh/open",
        logStart: true,
        logSuccess: true,
      });

      logger.info("FE/connector/ssh/open", `成功连接到 ${this.config.host}:${this.config.port}`);
    } catch (error) {
      logger.error("FE/connector/ssh/open", "连接失败", error);
      throw error;
    }
  }

  close(): void {
    if (!this.sessionId) return;

    try {
      invokeTauriBackground("close_ssh_session", { sessionId: this.sessionId }, { scope: "FE/connector/ssh/close" });
    } catch (error) {
      logger.error("FE/connector/ssh/close", "关闭连接时出错", error);
    } finally {
      if (this.unlistenFn) {
        try {
          this.unlistenFn();
        } catch (error) {
          logger.warn("FE/connector/ssh/close", "取消事件监听失败", error);
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
    logger.debug("FE/connector/ssh/listen", `Listening for event: ${eventName}`);
    
    // 直接将数据传递给 handler，不要使用 setTimeout 或者合并数组，xterm 底层具备极好的缓冲机制
    this.unlistenFn = await listen<string>(eventName, (event) => {
      const data = event.payload;
      if (data) handler(data);
    });
    
    logger.debug("FE/connector/ssh/listen", "Event listener registered");
    
    const closeEventName = `terminal-close-${this.sessionId}`;
    const closeUnlisten = await listen(closeEventName, () => {
      logger.info("FE/connector/ssh/listen", "Connection closed event received");
      this.handleDisconnect();
    });
    
    const originalUnlistenFn = this.unlistenFn;
    this.unlistenFn = () => {
      if (originalUnlistenFn) originalUnlistenFn();
      closeUnlisten();
    };
  }

  private handleDisconnect(): void {
    logger.info("FE/connector/ssh/disconnect", "Handling disconnection");
    this.sessionId = null;
    if (this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
  }

  write(data: string | Uint8Array): void {
    if (!this.sessionId) return;

    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    
    invokeTauri("write_to_ssh_session", {
      sessionId: this.sessionId,
      data: text,
    }, {
      scope: "FE/connector/ssh/write",
    }).catch((err) => {
      logger.error("FE/connector/ssh/write", "写入失败", err);
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.sessionId) return;

    invokeTauri("resize_ssh_session", {
      sessionId: this.sessionId,
      cols,
      rows,
    }, {
      scope: "FE/connector/ssh/resize",
    }).catch((err) => {
      logger.error("FE/connector/ssh/resize", "调整大小失败", err);
    });
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getConfig(): SSHConfig {
    return this.config;
  }
}