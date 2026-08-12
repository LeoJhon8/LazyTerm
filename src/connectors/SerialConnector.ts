import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConnectionStateEvent, ITerminalConnector, SerialConfig } from "@/types/terminal";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground, invokeTauriSerialized } from "@/services/tauri";
import { classifyConnectionFailure } from "@/services/connection/connectionErrors";
import { ConnectionReadinessBarrier } from "@/services/connection/ConnectionReadinessBarrier";
import { ConnectionStateEmitter } from "./ConnectionStateEmitter";

const SERIAL_USABLE_CHECKPOINTS = ["identity", "listeners", "backend", "remote"] as const;
const SERIAL_PENDING_DATA_LIMIT = 1024 * 1024;

export class SerialConnector implements ITerminalConnector {
  readonly protocol = "serial" as const;
  private readonly config: SerialConfig;
  private readonly requestedSessionId = `serial-${crypto.randomUUID()}`;
  private readonly readiness = new ConnectionReadinessBarrier();
  private readonly readinessCycle: number;
  private readonly stateEmitter = new ConnectionStateEmitter("FE/connector/serial/state");
  private unlistenFn: UnlistenFn | null = null;
  private sessionId: string | null = null;
  private openPromise: Promise<void> | null = null;
  private closedBeforeConnect = false;
  private disconnected = false;
  private hasReceivedData = false;
  private listenersPromise: Promise<void> | null = null;
  private dataHandler: ((data: string) => void) | null = null;
  private pendingData = "";

  constructor(config: SerialConfig) {
    this.config = config;
    this.readinessCycle = this.readiness.begin(["identity"]);
  }

  get isConnected(): boolean {
    return this.sessionId === this.requestedSessionId
      && this.readiness.has(this.readinessCycle, SERIAL_USABLE_CHECKPOINTS);
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

  onConnectionState(handler: (event: ConnectionStateEvent) => void): () => void {
    return this.stateEmitter.subscribe(handler);
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

  write(data: string | Uint8Array): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    const sessionId = this.sessionId;
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    invokeTauriSerialized(`serial:${sessionId}:write`, "write_serial", {
      sessionId,
      data: text,
    }, {
      scope: "FE/connector/serial/write",
    }).catch((error) => {
      logger.error("FE/connector/serial/write", "Write failed", error);
      if (this.sessionId === sessionId) {
        this.handleDisconnect(error);
      }
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.isConnected || !this.sessionId) {
      return;
    }

    invokeTauriSerialized(`serial:${this.sessionId}:resize`, "resize_serial", {
      sessionId: this.sessionId,
      cols,
      rows,
    }, {
      scope: "FE/connector/serial/resize",
    }).catch((error) => {
      logger.error("FE/connector/serial/resize", "Resize failed", error);
    });
  }

  close(): void {
    this.stateEmitter.emit({ phase: "closing", stage: "closing" });
    this.closedBeforeConnect = true;
    this.readiness.fail(this.readinessCycle, new Error("Serial connection closed"));
    invokeTauriBackground(
      "close_serial",
      { sessionId: this.sessionId ?? this.requestedSessionId },
      { scope: "FE/connector/serial/close" },
    );
    this.sessionId = null;
    this.cleanupListeners();
    this.pendingData = "";
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
        throw new Error("Serial connection was closed before initialization completed");
      }

      await invokeTauri("open_serial_session", {
        sessionId: this.requestedSessionId,
        config: this.config,
      }, {
        scope: "FE/connector/serial/open",
        logStart: true,
        logSuccess: true,
      });

      if (this.closedBeforeConnect || this.disconnected) {
        invokeTauriBackground("close_serial", { sessionId: this.requestedSessionId }, { scope: "FE/connector/serial/close" });
        throw new Error("Serial connection was closed before initialization completed");
      }

      this.sessionId = this.requestedSessionId;
      this.readiness.mark(this.readinessCycle, "backend");
      this.readiness.mark(this.readinessCycle, "remote");
      await this.readiness.waitFor(this.readinessCycle, SERIAL_USABLE_CHECKPOINTS);
      this.stateEmitter.emit({
        phase: "connected",
        stage: this.readiness.has(this.readinessCycle, ["first-data"]) ? "steady" : "first-data",
        health: "healthy",
      });
    } catch (error) {
      this.readiness.fail(this.readinessCycle, error);
      this.sessionId = null;
      this.cleanupListeners();
      logger.error("FE/connector/serial/open", "Failed to open serial port via Rust", error);
      if (!this.closedBeforeConnect && !this.disconnected) {
        const failure = classifyConnectionFailure(this.protocol, error, { stage: "transport" });
        this.stateEmitter.emit({ phase: "failed", stage: failure.stage, reason: "串口连接失败", failure });
      }
      throw error;
    }
  }

  private handleDisconnect(reason: unknown): void {
    if (this.disconnected || this.closedBeforeConnect) {
      return;
    }

    this.disconnected = true;
    this.readiness.fail(this.readinessCycle, reason);
    this.sessionId = null;
    const failure = classifyConnectionFailure(this.protocol, reason, {
      stage: "steady",
      fallbackCode: "DEVICE_REMOVED",
    });
    this.stateEmitter.emit({
      phase: "disconnected",
      stage: "steady",
      reason: "串口连接已断开",
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
    const sessionId = this.requestedSessionId;
    let dataUnlisten: UnlistenFn | null = null;
    let closeUnlisten: UnlistenFn | null = null;
    try {
      dataUnlisten = await listen<string>(`serial-data-${sessionId}`, (event) => {
        if (!this.hasReceivedData) {
          this.hasReceivedData = true;
          this.readiness.mark(this.readinessCycle, "first-data");
          if (this.isConnected) {
            this.stateEmitter.emit({ phase: "connected", stage: "steady", health: "healthy" });
          }
        }
        if (this.dataHandler) {
          this.dataHandler(event.payload);
        } else {
          this.pendingData = `${this.pendingData}${event.payload}`.slice(-SERIAL_PENDING_DATA_LIMIT);
        }
      });
      closeUnlisten = await listen<string>(`serial-close-${sessionId}`, (event) => {
        this.handleDisconnect(event.payload || "Serial device disconnected");
      });
      this.unlistenFn = () => {
        dataUnlisten?.();
        closeUnlisten?.();
      };
      if (this.closedBeforeConnect || this.disconnected) {
        throw new Error("Serial connection closed while event listeners were registering");
      }
    } catch (error) {
      dataUnlisten?.();
      closeUnlisten?.();
      this.unlistenFn = null;
      throw error;
    }
  }

  private cleanupListeners(): void {
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
    this.listenersPromise = null;
    this.dataHandler = null;
  }
}
