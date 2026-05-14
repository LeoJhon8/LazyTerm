import type { AiCliConfig, ITerminalConnector } from "@/types/terminal";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground } from "@/services/tauri";
import { useNotificationsStore } from "@/store/notifications";

function stripAnsiSequences(value: string) {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "")
    .replace(/\r/g, "\n");
}

function containsAiConfirmationPrompt(text: string) {
  const normalized = text.toLowerCase();
  return [
    "do you want to",
    "would you like to",
    "are you sure",
    "proceed?",
    "continue?",
    "allow",
    "approve",
    "confirm",
    "yes/no",
    "[y/n]",
    "(y/n)",
    "是否继续",
    "确认",
    "允许",
    "批准",
    "继续吗",
  ].some((pattern) => normalized.includes(pattern));
}

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
  private onDisconnectCallback?: () => void;
  private dataHandler: ((data: string) => void) | null = null;
  private lastWriteDedup: { data: string; at: number } | null = null;
  private lastReadDedup: { data: string; at: number } | null = null;
  private promptState = {
    waitingForOutput: false,
    hasOutput: false,
    outputBuffer: "",
    completionTimerId: undefined as number | undefined,
    confirmationNotified: false,
  };

  constructor(config: AiCliConfig, onDisconnect?: () => void, appSessionId?: string) {
    this.config = config;
    this.onDisconnectCallback = onDisconnect;
    this.appSessionId = appSessionId ?? null;
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
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
    } catch (error) {
      logger.error("FE/connector/ai-cli/open", "Failed to spawn AI CLI via Rust", error);
      throw error;
    }
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

    const dataStr = typeof data === "string" ? data : new TextDecoder().decode(data);
    const now = performance.now();
    if (
      this.lastWriteDedup &&
      this.lastWriteDedup.data === dataStr &&
      now - this.lastWriteDedup.at < 40
    ) {
      logger.warn("FE/connector/ai-cli/write", "Dropped duplicate write chunk", {
        size: dataStr.length,
      });
      return;
    }
    this.lastWriteDedup = { data: dataStr, at: now };

    if (dataStr.includes("\r") || dataStr.includes("\n")) {
      this.startPromptTracking();
    }

    invokeTauri("write_to_terminal", {
      sessionId: this.sessionId,
      data: dataStr,
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
      rows,
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
    this.dataHandler = null;
    this.clearPromptTimer();
  }

  private async ensureListeners(): Promise<void> {
    if (!this.sessionId || this.unlistenFn) return;

    const sessionId = this.sessionId;
    const dataUnlisten = await listen<string>(`terminal-data-${sessionId}`, (event) => {
      this.handleData(event.payload);
    });
    const closeUnlisten = await listen(`terminal-close-${sessionId}`, () => {
      this.notifyExit();
      this.handleDisconnect();
    });

    this.unlistenFn = () => {
      dataUnlisten();
      closeUnlisten();
    };
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

  private startPromptTracking(): void {
    this.clearPromptTimer();
    this.promptState = {
      waitingForOutput: true,
      hasOutput: false,
      outputBuffer: "",
      completionTimerId: undefined,
      confirmationNotified: false,
    };
  }

  private clearPromptTimer(): void {
    if (this.promptState.completionTimerId) {
      window.clearTimeout(this.promptState.completionTimerId);
    }
    this.promptState.completionTimerId = undefined;
  }

  private handleData(data: string): void {
    const now = performance.now();
    if (
      this.lastReadDedup &&
      this.lastReadDedup.data === data &&
      now - this.lastReadDedup.at < 40
    ) {
      logger.warn("FE/connector/ai-cli/data", "Dropped duplicate read chunk", {
        size: data.length,
      });
      return;
    }
    this.lastReadDedup = { data, at: now };

    this.dataHandler?.(data);

    const state = this.promptState;
    if (!state.waitingForOutput) {
      return;
    }

    const text = stripAnsiSequences(data);
    if (!text.trim()) {
      return;
    }

    state.hasOutput = true;
    state.outputBuffer = `${state.outputBuffer}${text}`.slice(-4000);

    if (!state.confirmationNotified && containsAiConfirmationPrompt(state.outputBuffer)) {
      this.notify("AI 请求确认");
      state.confirmationNotified = true;
    }

    this.clearPromptTimer();
    state.completionTimerId = window.setTimeout(() => {
      if (!this.promptState.waitingForOutput || !this.promptState.hasOutput || this.promptState.confirmationNotified) {
        return;
      }

      this.notify("AI 任务完成");
      this.promptState = {
        waitingForOutput: false,
        hasOutput: false,
        outputBuffer: "",
        completionTimerId: undefined,
        confirmationNotified: false,
      };
    }, 10000);
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
    this.dataHandler = null;
    this.clearPromptTimer();

    this.onDisconnectCallback?.();
  }
}
