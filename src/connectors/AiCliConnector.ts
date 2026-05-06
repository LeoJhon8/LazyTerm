import type { ITerminalConnector, AiCliConfig } from "@/types/terminal";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground } from "@/services/tauri";

/**
 * AI CLI 连接器
 * 通过 PTY 启动 AI CLI 工具（如 claude, openai, gemini 等）
 */
export class AiCliConnector implements ITerminalConnector {
  public readonly protocol = 'ai-cli' as const;
  private config: AiCliConfig;
  private unlistenFn: UnlistenFn | null = null;
  private sessionId: string | null = null;
  private onDisconnectCallback?: () => void;

  constructor(config: AiCliConfig, onDisconnect?: () => void) {
    this.config = config;
    this.onDisconnectCallback = onDisconnect;
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
    try {
      // 构造完整的命令行
      const fullCommand = [
        this.config.command,
        ...(this.config.args || [])
      ].join(' ');

      logger.info("FE/connector/ai-cli/open", `启动 AI CLI: command=${this.config.command}, args=${JSON.stringify(this.config.args)}, cwd=${this.config.cwd}, fullCommand=${fullCommand}`);

      // 使用 init_command 方式：先启动 cmd.exe，再通过 PTY 写入命令
      // 这比 cmd /k 更可靠，因为 portable_pty 的 CommandBuilder 对 cmd.exe 参数处理存在问题
      this.sessionId = await invokeTauri<string>("create_terminal", {
        cwd: this.config.cwd || null,
        shell: "cmd.exe",
        initCommand: fullCommand || null,
      }, {
        scope: "FE/connector/ai-cli/open",
        logStart: true,
        logSuccess: true,
      });

      logger.info("FE/connector/ai-cli/open", `AI CLI 启动成功，sessionId=${this.sessionId}`);
    } catch (error) {
      logger.error("FE/connector/ai-cli/open", "Failed to spawn AI CLI via Rust", error);
      throw error;
    }
  }

  // 监听来自 Rust 的事件
  async onData(handler: (data: string) => void): Promise<void> {
    // 等待 sessionId 可用
    if (!this.sessionId) {
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
    
    invokeTauri("write_to_terminal", {
      sessionId: this.sessionId, 
      data: dataStr 
    }, {
      scope: "FE/connector/ai-cli/write",
    }).catch((error) => {
      logger.error("FE/connector/ai-cli/write", "Write failed", error);
      this.handleDisconnect();
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.sessionId) return;
    
    invokeTauri("resize_terminal", {
      sessionId: this.sessionId, 
      cols, 
      rows 
    }, {
      scope: "FE/connector/ai-cli/resize",
    }).catch((error) => {
      logger.error("FE/connector/ai-cli/resize", "Resize failed", error);
      this.handleDisconnect();
    });
  }

  close(): void {
    if (this.sessionId) {
      invokeTauriBackground("close_terminal", { sessionId: this.sessionId }, { scope: "FE/connector/ai-cli/close" });
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
