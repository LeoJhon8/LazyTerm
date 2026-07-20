import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConnectionStateEvent, ITerminalConnector, SSHConfig } from "@/types/terminal";
import { ConnectionStateEmitter } from "./ConnectionStateEmitter";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground, invokeTauriSerialized } from "@/services/tauri";

/**
 * 估算初始 PTY 大小所需的字体配置
 */
export interface PtyFontConfig {
  fontFamily: string;
  fontSize: number;
}

/**
 * 获取默认字体配置
 */
function getDefaultFontConfig(): PtyFontConfig {
  return {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: 14,
  };
}

/**
 * 估算初始 PTY 大小
 * 根据容器尺寸和字体配置计算行列数
 */
function estimateInitialPtySize(fontConfig?: PtyFontConfig): { cols: number; rows: number } {
  if (typeof window === "undefined") {
    return { cols: 80, rows: 24 };
  }

  const { fontFamily, fontSize } = fontConfig ?? getDefaultFontConfig();
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

export interface SshConnectorOptions {
  config: SSHConfig;
  fontConfig?: PtyFontConfig;
}

export class SshConnector implements ITerminalConnector {
  readonly protocol = "ssh" as const;
  private config: SSHConfig;
  private fontConfig?: PtyFontConfig;
  private unlistenFn: UnlistenFn | null = null;
  private sessionId: string | null = null;
  private startupCommandSessionId: string | null = null;
  private readonly stateEmitter = new ConnectionStateEmitter("FE/connector/ssh/state");

  constructor(options: SshConnectorOptions) {
    this.config = options.config;
    this.fontConfig = options.fontConfig;
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
    if (this.isConnected) {
      throw new Error("SSH 连接已建立");
    }

    this.stateEmitter.emit({ phase: "connecting" });
    try {
      const initialSize = estimateInitialPtySize(this.fontConfig);
      const shouldSendKeepAlive = this.config.port !== 2222;
      const keepAlive = this.config.keepAlive ?? true;
      const keepAliveInterval = Math.max(1, Math.floor(this.config.keepAliveInterval ?? 60));

      this.stateEmitter.emit({ phase: "authenticating" });
      this.sessionId = await invokeTauri<string>("create_ssh_session", {
        config: {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.authType === "password" ? this.config.password : undefined,
          private_key_path: this.config.authType === "privateKey" ? this.config.privateKeyPath : undefined,
          private_key: this.config.authType === "privateKey" ? this.config.privateKey : undefined,
          private_key_passphrase: this.config.authType === "privateKey" ? this.config.privateKeyPassphrase : undefined,
          keep_alive: shouldSendKeepAlive ? keepAlive : undefined,
          keep_alive_interval: shouldSendKeepAlive ? keepAliveInterval : undefined,
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
      this.stateEmitter.emit({ phase: "connected" });
    } catch (error) {
      logger.error("FE/connector/ssh/open", "连接失败", error);
      this.stateEmitter.emit({ phase: "failed", reason: "SSH 连接失败", technicalDetails: String(error) });
      throw error;
    }
  }

  onConnectionState(handler: (event: ConnectionStateEvent) => void): () => void {
    return this.stateEmitter.subscribe(handler);
  }

  close(): void {
    this.stateEmitter.emit({ phase: "closing" });
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
      if (data) {
        handler(data);
      }
    });
    
    logger.debug("FE/connector/ssh/listen", "Event listener registered");
    
    const closeEventName = `terminal-close-${this.sessionId}`;
    const closeUnlisten = await listen<string>(closeEventName, (event) => {
      const reason = event.payload || "unknown";
      logger.info("FE/connector/ssh/listen", `Connection closed event received: ${reason}`);
      this.handleDisconnect(reason);
    });
    
    const originalUnlistenFn = this.unlistenFn;
    this.unlistenFn = () => {
      if (originalUnlistenFn) originalUnlistenFn();
      closeUnlisten();
    };

    this.sendStartupCommandOnce();
  }

  private sendStartupCommandOnce(): void {
    const sessionId = this.sessionId;
    const startupCommand = this.config.startupCommand;
    if (!sessionId || !startupCommand?.trim() || this.startupCommandSessionId === sessionId) {
      return;
    }

    this.startupCommandSessionId = sessionId;
    const normalizedCommand = startupCommand.replace(/\r?\n/g, "\r");
    this.write(normalizedCommand);
    logger.info("FE/connector/ssh/startup-command", "SSH 启动命令已发送");
  }

  private handleDisconnect(reason: string = "unknown"): void {
    logger.info("FE/connector/ssh/disconnect", `Handling disconnection: ${reason}`);
    this.sessionId = null;
    this.stateEmitter.emit({ phase: "disconnected", reason: "SSH 连接已断开", technicalDetails: reason });
  }

  write(data: string | Uint8Array): void {
    if (!this.sessionId) return;

    const sessionId = this.sessionId;
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    
    invokeTauriSerialized(`ssh:${sessionId}:write`, "write_to_ssh_session", {
      sessionId,
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
