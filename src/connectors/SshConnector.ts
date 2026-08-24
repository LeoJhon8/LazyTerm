import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ConnectionStateEvent,
  ITerminalConnector,
  SSHConfig,
  SshTmuxCapability,
} from "@/types/terminal";
import { ConnectionStateEmitter } from "./ConnectionStateEmitter";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriSerialized } from "@/services/tauri";
import { classifyConnectionFailure } from "@/services/connection/connectionErrors";
import { ConnectionReadinessBarrier } from "@/services/connection/ConnectionReadinessBarrier";
import { useSettingsStore } from "@/store/settings";
import { IS_DESKTOP } from "@/lib/platform";

const SSH_USABLE_CHECKPOINTS = ["identity", "listeners", "backend", "remote"] as const;
const SSH_PENDING_DATA_LIMIT = 1024 * 1024;

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
  backgroundModeEnabled?: boolean;
  tmuxPersistenceEnabled?: boolean;
  logicalSessionKey?: string;
  tmuxSessionName?: string;
}

export class SshConnector implements ITerminalConnector {
  readonly protocol = "ssh" as const;
  private config: SSHConfig;
  private fontConfig?: PtyFontConfig;
  private unlistenFn: UnlistenFn | null = null;
  private readonly requestedSessionId = crypto.randomUUID();
  private sessionId: string | null = null;
  private openPromise: Promise<void> | null = null;
  private closedBeforeConnect = false;
  private disconnected = false;
  private hasReceivedData = false;
  private startupCommandSessionId: string | null = null;
  private readonly readiness = new ConnectionReadinessBarrier();
  private readonly readinessCycle: number;
  private readonly stateEmitter = new ConnectionStateEmitter("FE/connector/ssh/state");
  private listenersPromise: Promise<void> | null = null;
  private dataHandler: ((data: string) => void) | null = null;
  private pendingData = "";
  private lastResize: { sessionId: string; cols: number; rows: number } | null = null;
  private backgroundModeEnabled: boolean;
  private tmuxPersistenceEnabled: boolean;
  private tmuxPersistenceActive = false;
  private readonly logicalSessionKey: string;
  private tmuxSessionName: string;
  private appliedBackgroundModeEnabled: boolean | null = null;
  private backgroundModeUpdatePending: Promise<void> | null = null;

  constructor(options: SshConnectorOptions) {
    this.config = options.config;
    this.fontConfig = options.fontConfig;
    this.backgroundModeEnabled = IS_DESKTOP && !!options.backgroundModeEnabled;
    this.tmuxPersistenceEnabled = IS_DESKTOP && !!options.tmuxPersistenceEnabled;
    this.logicalSessionKey = options.logicalSessionKey ?? this.requestedSessionId;
    this.tmuxSessionName = options.tmuxSessionName ?? `lazyterm_${this.requestedSessionId.replaceAll("-", "")}`;
    this.readinessCycle = this.readiness.begin(["identity"]);
  }

  get isConnected(): boolean {
    return this.sessionId === this.requestedSessionId
      && this.readiness.has(this.readinessCycle, SSH_USABLE_CHECKPOINTS);
  }

  async open(): Promise<void> {
    if (this.isConnected) {
      return;
    }
    if (!this.openPromise) {
      this.openPromise = this.openSession().finally(() => {
        this.openPromise = null;
      });
    }
    await this.openPromise;
  }

  private async openSession(): Promise<void> {
    this.stateEmitter.emit({ phase: "connecting", stage: "transport" });
    this.closedBeforeConnect = false;
    this.disconnected = false;
    this.hasReceivedData = false;
    try {
      await this.ensureEventListeners();
      this.readiness.mark(this.readinessCycle, "listeners");
      await this.readiness.waitFor(this.readinessCycle, ["identity", "listeners"]);
      if (this.closedBeforeConnect) {
        throw new Error("SSH connection was closed before initialization completed");
      }

      const initialSize = estimateInitialPtySize(this.fontConfig);
      const shouldSendKeepAlive = this.config.port !== 2222;
      const keepAlive = this.config.keepAlive ?? true;
      const keepAliveInterval = Math.max(1, Math.floor(this.config.keepAliveInterval ?? 60));
      const autoUpdateChangedSshHostKeys = useSettingsStore.getState().autoUpdateChangedSshHostKeys;
      const requestedBackgroundMode = this.backgroundModeEnabled;
      const requestedTmuxPersistence = requestedBackgroundMode && this.tmuxPersistenceEnabled;

      this.stateEmitter.emit({ phase: "authenticating", stage: "authentication" });
      const createdSessionId = await invokeTauriSerialized<string>(`ssh-tab:${this.logicalSessionKey}:lifecycle`, "create_ssh_session", {
        sessionId: this.requestedSessionId,
        config: {
          client_session_key: this.logicalSessionKey,
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
          auto_update_changed_host_keys: autoUpdateChangedSshHostKeys,
          initial_cols: initialSize.cols,
          initial_rows: initialSize.rows,
          background_mode: requestedBackgroundMode,
          tmux_persistence: requestedTmuxPersistence,
          tmux_session_name: this.tmuxSessionName,
        },
      }, {
        scope: "FE/connector/ssh/open",
        logStart: true,
        logSuccess: true,
      });

      if (this.closedBeforeConnect || this.disconnected) {
        void this.closeBackendSession(createdSessionId);
        throw new Error("SSH connection was closed before initialization completed");
      }
      this.sessionId = createdSessionId;
      this.tmuxPersistenceActive = requestedTmuxPersistence;
      this.appliedBackgroundModeEnabled = requestedBackgroundMode;
      this.syncBackgroundMode();
      this.lastResize = null;
      this.readiness.mark(this.readinessCycle, "backend");
      this.readiness.mark(this.readinessCycle, "remote");
      await this.readiness.waitFor(this.readinessCycle, SSH_USABLE_CHECKPOINTS);

      logger.info("FE/connector/ssh/open", `成功连接到 ${this.config.host}:${this.config.port}`);
      this.stateEmitter.emit({
        phase: "connected",
        stage: this.readiness.has(this.readinessCycle, ["first-data"]) ? "steady" : "first-data",
        health: "healthy",
      });
      this.sendStartupCommandOnce();
    } catch (error) {
      this.readiness.fail(this.readinessCycle, error);
      this.sessionId = null;
      this.tmuxPersistenceActive = false;
      this.appliedBackgroundModeEnabled = null;
      this.cleanupListeners();
      logger.error("FE/connector/ssh/open", "连接失败", error);
      if (!this.closedBeforeConnect && !this.disconnected) {
        const failure = classifyConnectionFailure(this.protocol, error, { stage: "authentication" });
        this.stateEmitter.emit({ phase: "failed", stage: failure.stage, reason: "SSH 连接失败", failure });
      }
      throw error;
    }
  }

  onConnectionState(handler: (event: ConnectionStateEvent) => void): () => void {
    return this.stateEmitter.subscribe(handler);
  }

  close(): void {
    this.stateEmitter.emit({ phase: "closing", stage: "closing" });
    this.closedBeforeConnect = true;
    this.readiness.fail(this.readinessCycle, new Error("SSH connection closed"));

    const sessionId = this.sessionId ?? this.requestedSessionId;
    void this.closeBackendSession(sessionId);
    this.cleanupListeners();
    this.pendingData = "";
    this.lastResize = null;
    this.sessionId = null;
    this.tmuxPersistenceActive = false;
    this.appliedBackgroundModeEnabled = null;
  }

  private closeBackendSession(sessionId: string): Promise<void> {
    return invokeTauriSerialized<void>(
      `ssh-tab:${this.logicalSessionKey}:lifecycle`,
      "close_ssh_session",
      { sessionId },
      { scope: "FE/connector/ssh/close" },
    ).catch((error) => {
      logger.error("FE/connector/ssh/close", "关闭连接时出错", error);
    });
  }

  async onData(handler: (data: string) => void): Promise<() => void> {
    await this.ensureEventListeners();
    const pendingData = this.pendingData;
    this.pendingData = "";
    this.dataHandler = handler;
    if (pendingData) {
      handler(pendingData);
    }
    return () => {
      if (this.dataHandler === handler) {
        this.dataHandler = null;
      }
    };
  }

  private sendStartupCommandOnce(): void {
    const sessionId = this.sessionId;
    const startupCommand = this.config.startupCommand;
    if (!sessionId || !startupCommand?.trim() || this.startupCommandSessionId === sessionId) {
      return;
    }

    this.startupCommandSessionId = sessionId;
    const normalizedCommand = startupCommand.replace(/\r\n|\n|\r/g, "\r");
    this.write(normalizedCommand.endsWith("\r") ? normalizedCommand : `${normalizedCommand}\r`);
    logger.info("FE/connector/ssh/startup-command", "SSH 启动命令已发送");
  }

  private handleDisconnect(reason: string = "unknown"): void {
    if (this.disconnected || this.closedBeforeConnect) {
      return;
    }
    this.disconnected = true;
    this.readiness.fail(this.readinessCycle, reason);
    logger.info("FE/connector/ssh/disconnect", `Handling disconnection: ${reason}`);
    this.sessionId = null;
    this.tmuxPersistenceActive = false;
    this.appliedBackgroundModeEnabled = null;
    const failure = classifyConnectionFailure(this.protocol, reason, {
      stage: "steady",
      fallbackCode: "REMOTE_CLOSED",
    });
    this.stateEmitter.emit({
      phase: "disconnected",
      stage: "steady",
      reason: "SSH 连接已断开",
      failure,
    });
    this.cleanupListeners();
  }

  private async ensureEventListeners(): Promise<void> {
    if (this.unlistenFn) {
      return;
    }
    if (!this.listenersPromise) {
      this.listenersPromise = this.setupEventListeners().catch((error) => {
        this.listenersPromise = null;
        this.readiness.fail(this.readinessCycle, error);
        throw error;
      });
    }
    await this.listenersPromise;
  }

  private async setupEventListeners(): Promise<void> {
    const eventName = `terminal-data-${this.requestedSessionId}`;
    const closeEventName = `terminal-close-${this.requestedSessionId}`;
    logger.debug("FE/connector/ssh/listen", `Listening for events: ${eventName}, ${closeEventName}`);

    let dataUnlisten: UnlistenFn | null = null;
    let closeUnlisten: UnlistenFn | null = null;
    try {
      dataUnlisten = await listen<string>(eventName, (event) => {
        const data = event.payload;
        if (!data) {
          return;
        }
        if (!this.hasReceivedData) {
          this.hasReceivedData = true;
          this.readiness.mark(this.readinessCycle, "first-data");
          if (this.isConnected) {
            this.stateEmitter.emit({ phase: "connected", stage: "steady", health: "healthy" });
          }
        }
        if (this.dataHandler) {
          this.dataHandler(data);
        } else {
          this.pendingData = `${this.pendingData}${data}`.slice(-SSH_PENDING_DATA_LIMIT);
        }
      });
      closeUnlisten = await listen<string>(closeEventName, (event) => {
        const reason = event.payload || "unknown";
        logger.info("FE/connector/ssh/listen", `Connection closed event received: ${reason}`);
        this.handleDisconnect(reason);
      });
      this.unlistenFn = () => {
        dataUnlisten?.();
        closeUnlisten?.();
      };
      if (this.closedBeforeConnect || this.disconnected) {
        throw new Error("SSH connection closed while event listeners were registering");
      }
      logger.debug("FE/connector/ssh/listen", "SSH event listeners registered");
    } catch (error) {
      dataUnlisten?.();
      closeUnlisten?.();
      this.unlistenFn = null;
      throw error;
    }
  }

  write(data: string | Uint8Array): void {
    if (!this.isConnected || !this.sessionId) return;

    const sessionId = this.sessionId;
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    
    invokeTauriSerialized(`ssh:${sessionId}:write`, "write_to_ssh_session", {
      sessionId,
      data: text,
    }, {
      scope: "FE/connector/ssh/write",
    }).catch((err) => {
      logger.error("FE/connector/ssh/write", "写入失败", err);
      if (this.sessionId === sessionId) {
        this.handleDisconnect(String(err));
      }
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.isConnected || !this.sessionId) return;

    const normalizedCols = Math.max(1, Math.floor(cols));
    const normalizedRows = Math.max(1, Math.floor(rows));
    if (
      this.lastResize?.sessionId === this.sessionId
      && this.lastResize.cols === normalizedCols
      && this.lastResize.rows === normalizedRows
    ) {
      return;
    }

    const request = {
      sessionId: this.sessionId,
      cols: normalizedCols,
      rows: normalizedRows,
    };
    this.lastResize = request;

    invokeTauriSerialized(`ssh:${this.sessionId}:resize`, "resize_ssh_session", {
      sessionId: this.sessionId,
      cols: normalizedCols,
      rows: normalizedRows,
    }, {
      scope: "FE/connector/ssh/resize",
    }).catch((err) => {
      logger.error("FE/connector/ssh/resize", "调整大小失败", err);
      if (this.lastResize === request) {
        this.lastResize = null;
      }
    });
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getConfig(): SSHConfig {
    return this.config;
  }

  setBackgroundMode(enabled: boolean): void {
    const nextEnabled = IS_DESKTOP && enabled;
    this.backgroundModeEnabled = nextEnabled;
    this.syncBackgroundMode();
  }

  setTmuxPersistenceEnabled(enabled: boolean): void {
    this.tmuxPersistenceEnabled = IS_DESKTOP && enabled;
  }

  setTmuxSessionName(name: string): void {
    if (this.tmuxPersistenceActive) {
      return;
    }
    this.tmuxSessionName = name;
  }

  async checkTmuxCapability(): Promise<SshTmuxCapability> {
    if (!IS_DESKTOP || !this.isConnected || !this.sessionId) {
      throw new Error("SSH 会话尚未连接");
    }

    return invokeTauri<SshTmuxCapability>("check_ssh_tmux_capability", {
      sessionId: this.sessionId,
    }, {
      scope: "FE/connector/ssh/tmux-capability",
    });
  }

  isTmuxPersistenceActive(): boolean {
    return this.tmuxPersistenceActive;
  }

  async killTmuxSession(): Promise<void> {
    if (!IS_DESKTOP || !this.isConnected || !this.sessionId || !this.tmuxPersistenceActive) {
      throw new Error("当前 SSH 连接未附着可恢复 tmux 会话");
    }

    await invokeTauri<void>("kill_ssh_tmux_session", {
      sessionId: this.sessionId,
    }, {
      scope: "FE/connector/ssh/tmux-kill",
    });
    this.tmuxPersistenceActive = false;
  }

  private syncBackgroundMode(): void {
    const sessionId = this.sessionId;
    if (
      !sessionId
      || this.backgroundModeUpdatePending
      || this.appliedBackgroundModeEnabled === this.backgroundModeEnabled
    ) {
      return;
    }

    const requestedEnabled = this.backgroundModeEnabled;
    const request = invokeTauriSerialized(`ssh:${sessionId}:background-mode`, "set_ssh_background_mode", {
      sessionId,
      enabled: requestedEnabled,
    }, {
      scope: "FE/connector/ssh/background-mode",
    }).then(() => {
      if (this.sessionId === sessionId) {
        this.appliedBackgroundModeEnabled = requestedEnabled;
      }
    }).catch((error) => {
      logger.error("FE/connector/ssh/background-mode", "更新 SSH 后台模式失败", error);
    }).finally(() => {
      if (this.backgroundModeUpdatePending === request) {
        this.backgroundModeUpdatePending = null;
      }
      if (this.sessionId === sessionId) {
        this.syncBackgroundMode();
      }
    });
    this.backgroundModeUpdatePending = request;
  }

  private cleanupListeners(): void {
    if (this.unlistenFn) {
      try {
        this.unlistenFn();
      } catch (error) {
        logger.warn("FE/connector/ssh/close", "取消事件监听失败", error);
      }
      this.unlistenFn = null;
    }
    this.listenersPromise = null;
    this.dataHandler = null;
  }
}
