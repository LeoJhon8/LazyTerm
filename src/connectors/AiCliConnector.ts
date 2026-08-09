import type { AiCliConfig, ConnectionStateEvent, ITerminalConnector } from "@/types/terminal";
import { ConnectionStateEmitter } from "./ConnectionStateEmitter";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground, invokeTauriSerialized } from "@/services/tauri";
import { useNotificationsStore } from "@/store/notifications";

function isSessionVisible(appSessionId: string | null) {
  if (!appSessionId) return false;
  return Array.from(document.querySelectorAll("[data-session-id]")).some(
    (element) => element.getAttribute("data-session-id") === appSessionId
  );
}

export class AiCliConnector implements ITerminalConnector {
  public readonly protocol = "ai-cli" as const;
  private config: AiCliConfig;
  private unlistenFn: UnlistenFn | null = null;
  private sessionId: string | null = null;
  private appSessionId: string | null = null;
  private readonly stateEmitter = new ConnectionStateEmitter("FE/connector/ai-cli/state");
  private dataHandler: ((data: string) => void) | null = null;
  private listenerSetupPromise: Promise<void> | null = null;

  constructor(config: AiCliConfig, appSessionId?: string) {
    this.config = config;
    this.appSessionId = appSessionId ?? null;
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
    this.stateEmitter.emit({ phase: "connecting" });
    try {
      const fullCommand = [
        this.config.command,
        ...(this.config.args || []),
      ].join(" ");

      logger.info("FE/connector/ai-cli/open", `启动 AI CLI: command=${this.config.command}, args=${JSON.stringify(this.config.args)}, cwd=${this.config.cwd}, fullCommand=${fullCommand}`);

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
      await this.ensureListeners();
      this.stateEmitter.emit({ phase: "connected" });
    } catch (error) {
      logger.error("FE/connector/ai-cli/open", "Failed to spawn AI CLI via Rust", error);
      this.stateEmitter.emit({ phase: "failed", reason: "AI CLI 启动失败", technicalDetails: String(error) });
      throw error;
    }
  }

  onConnectionState(handler: (event: ConnectionStateEvent) => void): () => void {
    return this.stateEmitter.subscribe(handler);
  }

  async onData(handler: (data: string) => void): Promise<() => void> {
    if (!this.sessionId) {
      await new Promise<void>((resolve) => {
        const checkInterval = window.setInterval(() => {
          if (this.sessionId) {
            window.clearInterval(checkInterval);
            resolve();
          }
        }, 10);

        window.setTimeout(() => {
          window.clearInterval(checkInterval);
          resolve();
        }, 5000);
      });

      if (!this.sessionId) {
        throw new Error("Session ID not available after timeout");
      }
    }

    await this.ensureListeners();
    this.dataHandler = handler;

    return () => {
      if (this.dataHandler === handler) {
        this.dataHandler = null;
      }
    };
  }

  write(data: string | Uint8Array): void {
    if (!this.sessionId) return;

    const sessionId = this.sessionId;
    const dataStr = typeof data === "string" ? data : new TextDecoder().decode(data);

    invokeTauriSerialized(`ai-cli:${sessionId}:write`, "write_to_terminal", {
      sessionId,
      data: dataStr,
    }, {
      scope: "FE/connector/ai-cli/write",
    }).catch((error) => {
      logger.error("FE/connector/ai-cli/write", "Write failed", error);
      if (this.sessionId === sessionId) {
        this.handleDisconnect();
      }
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.sessionId) return;

    invokeTauriSerialized(`ai-cli:${this.sessionId}:resize`, "resize_terminal", {
      sessionId: this.sessionId,
      cols,
      rows,
    }, {
      scope: "FE/connector/ai-cli/resize",
    }).catch((error) => {
      logger.error("FE/connector/ai-cli/resize", "Resize failed", error);
      this.handleDisconnect();
    });
  }

  close(): void {
    this.stateEmitter.emit({ phase: "closing" });
    if (this.sessionId) {
      invokeTauriBackground("close_terminal", { sessionId: this.sessionId }, { scope: "FE/connector/ai-cli/close" });
      this.sessionId = null;
    }
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
    this.dataHandler = null;
  }

  private async ensureListeners(): Promise<void> {
    if (!this.sessionId || this.unlistenFn) return;
    if (this.listenerSetupPromise) {
      await this.listenerSetupPromise;
      return;
    }

    const sessionId = this.sessionId;
    const setupPromise = this.registerListeners(sessionId);
    this.listenerSetupPromise = setupPromise;

    try {
      await setupPromise;
    } finally {
      if (this.listenerSetupPromise === setupPromise) {
        this.listenerSetupPromise = null;
      }
    }
  }

  private async registerListeners(sessionId: string): Promise<void> {
    let dataUnlisten: UnlistenFn | null = null;
    let closeUnlisten: UnlistenFn | null = null;

    try {
      dataUnlisten = await listen<string>(`terminal-data-${sessionId}`, (event) => {
        this.handleData(event.payload);
      });
      closeUnlisten = await listen(`terminal-close-${sessionId}`, () => {
        this.notifyExit();
        this.handleDisconnect();
      });

      if (this.sessionId !== sessionId || this.unlistenFn) {
        dataUnlisten();
        closeUnlisten();
        return;
      }

      this.unlistenFn = () => {
        dataUnlisten?.();
        closeUnlisten?.();
      };
    } catch (error) {
      dataUnlisten?.();
      closeUnlisten?.();
      throw error;
    }
  }

  private getDisplayName(): string {
    return this.config.nickname || this.config.command || "AI CLI";
  }

  private notify(title: string, message?: string): void {
    if (isSessionVisible(this.appSessionId)) {
      return;
    }

    useNotificationsStore.getState().addNotification({
      type: "info",
      source: "ai",
      title,
      message: message ?? this.getDisplayName(),
    });
  }

  private notifyExit(): void {
    this.notify(`退出 ${this.getDisplayName()} AI CLI`, "AI CLI 会话已结束");
  }

  private handleData(data: string): void {
    this.dataHandler?.(data);
  }

  private handleDisconnect(): void {
    if (!this.sessionId) {
      return;
    }

    this.sessionId = null;
    this.stateEmitter.emit({ phase: "disconnected", reason: "AI CLI 进程已退出" });

    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
    this.dataHandler = null;

  }
}
