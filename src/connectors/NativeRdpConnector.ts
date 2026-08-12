import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ConnectionStateEvent,
  INativeRdpConnector,
  NativeHostRect,
  NativeRdpStatePayload,
  RDPConfig,
} from "@/types/terminal";
import { ConnectionStateEmitter } from "./ConnectionStateEmitter";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errorUtils";
import { invokeTauri, invokeTauriBackground } from "@/services/tauri";
import { classifyConnectionFailure } from "@/services/connection/connectionErrors";
import { ConnectionReadinessBarrier } from "@/services/connection/ConnectionReadinessBarrier";

const FINAL_NATIVE_STATES: NativeRdpStatePayload["state"][] = ["closed"];
const NATIVE_BACKEND_CHECKPOINTS = ["identity", "listeners", "backend"] as const;
const NATIVE_USABLE_CHECKPOINTS = [...NATIVE_BACKEND_CHECKPOINTS, "remote"] as const;

export class NativeRdpConnector implements INativeRdpConnector {
  readonly protocol = "rdp" as const;
  readonly backend = "msrdpax" as const;

  private readonly config: RDPConfig;
  private readonly requestedSessionId = crypto.randomUUID();
  private readonly readiness = new ConnectionReadinessBarrier();
  private readonly readinessCycle: number;
  private sessionId: string | null = null;
  private connectPromise: Promise<string> | null = null;
  private closedBeforeConnect = false;
  private disconnected = false;
  private failureEmitted = false;
  private closeUnlisten: UnlistenFn | null = null;
  private stateUnlisten: UnlistenFn | null = null;
  private closeHandlers = new Set<() => void>();
  private readonly connectionStateEmitter = new ConnectionStateEmitter("FE/connector/native-rdp/connection-state");
  private stateHandlers = new Set<(payload: NativeRdpStatePayload) => void>();
  private listenersReady = false;
  private eventListenersPromise: Promise<void> | null = null;
  private visibilityRefCount = 0;
  private visibilityApplied: boolean | null = null;
  private finalStateLocked = false;
  private everConnected = false;
  private latestState: NativeRdpStatePayload = {
    state: "launching",
    detail: "正在准备 MsTscAx 原生宿主进程。",
  };

  constructor(config: RDPConfig) {
    this.config = config;
    this.readinessCycle = this.readiness.begin(["identity"]);
  }

  get isConnected(): boolean {
    return this.sessionId === this.requestedSessionId
      && this.readiness.has(this.readinessCycle, NATIVE_USABLE_CHECKPOINTS);
  }

  getLatestState(): NativeRdpStatePayload {
    return this.latestState;
  }

  hasEverConnected(): boolean {
    return this.everConnected;
  }

  async open(): Promise<void> {
    if (this.sessionId) {
      return;
    }

    if (!this.connectPromise) {
      this.connectionStateEmitter.emit({ phase: "connecting", stage: "transport" });
      this.closedBeforeConnect = false;
      this.disconnected = false;
      this.failureEmitted = false;
      this.finalStateLocked = false;
      this.everConnected = false;
      this.latestState = {
        state: "launching",
        detail: "正在准备 MsTscAx 原生宿主进程。",
      };
      this.connectPromise = (async () => {
        await this.ensureEventListeners(this.requestedSessionId);
        this.readiness.mark(this.readinessCycle, "listeners");
        await this.readiness.waitFor(this.readinessCycle, ["identity", "listeners"]);
        return await invokeTauri<string>("create_native_rdp_session", {
          sessionId: this.requestedSessionId,
          config: {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.password,
          domain: this.config.domain,
          },
        }, {
          scope: "FE/connector/native-rdp/open",
        });
      })().then(async (sessionId) => {
        if (this.closedBeforeConnect || this.disconnected) {
          invokeTauriBackground("close_native_rdp_session", { sessionId }, { scope: "FE/connector/native-rdp/close" });
          throw new Error("Native RDP session was closed before initialization completed");
        }

        this.sessionId = sessionId;
        this.readiness.mark(this.readinessCycle, "backend");
        await this.readiness.waitFor(this.readinessCycle, NATIVE_BACKEND_CHECKPOINTS);
        if (this.readiness.has(this.readinessCycle, ["remote"])) {
          this.connectionStateEmitter.emit({ phase: "connected", stage: "steady", health: "healthy" });
        } else {
          this.emitState({
            state: "launching",
            detail: "MsTscAx sidecar 已启动，等待原生宿主状态。",
          });
        }
        return sessionId;
      }).catch((error) => {
        this.readiness.fail(this.readinessCycle, error);
        this.cleanupListeners();
        if (!this.closedBeforeConnect && !this.disconnected && !this.failureEmitted) {
          const failure = classifyConnectionFailure(this.protocol, error, { stage: "session" });
          this.connectionStateEmitter.emit({
            phase: "failed",
            stage: failure.stage,
            reason: "RDP 连接失败",
            failure,
          });
        }
        throw error;
      }).finally(() => {
        this.connectPromise = null;
      });
    }

    await this.connectPromise;
  }

  onConnectionState(handler: (event: ConnectionStateEvent) => void): () => void {
    return this.connectionStateEmitter.subscribe(handler);
  }

  async onState(handler: (payload: NativeRdpStatePayload) => void): Promise<void> {
    this.stateHandlers.add(handler);
    handler(this.latestState);
    if (this.closedBeforeConnect) {
      return;
    }
    await this.ensureEventListeners(this.requestedSessionId);
    this.readiness.mark(this.readinessCycle, "listeners");
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  async mount(rect: NativeHostRect): Promise<void> {
    const sessionId = await this.getSessionIdOrNull();
    if (!sessionId) {
      return;
    }

    const normalizedRect: NativeHostRect = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
      scaleFactor: rect.scaleFactor,
      generation: rect.generation,
    };
    await invokeTauri("mount_native_rdp_session", { sessionId, rect: normalizedRect }, { scope: "FE/connector/native-rdp/mount" });
  }

  async setOverlayRect(rect: NativeHostRect | null): Promise<void> {
    const sessionId = await this.getSessionIdOrNull();
    if (!sessionId) {
      return;
    }

    const normalizedRect = rect
      ? {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(0, Math.round(rect.width)),
          height: Math.max(0, Math.round(rect.height)),
          scaleFactor: rect.scaleFactor,
        }
      : null;
    await invokeTauri(
      "set_native_rdp_session_overlay_rect",
      { sessionId, rect: normalizedRect },
      { scope: "FE/connector/native-rdp/overlay-rect" },
    );
  }

  async setVisible(visible: boolean): Promise<void> {
    if (visible) {
      this.visibilityRefCount += 1;
    } else {
      // Explicit hide requests (menu overlays, focus transitions) should be
      // authoritative, so force ref-count to zero to guarantee hidden state.
      this.visibilityRefCount = 0;
    }

    const nextVisible = this.visibilityRefCount > 0;

    const sessionId = await this.getSessionIdOrNull();
    if (!sessionId) {
      this.visibilityApplied = nextVisible;
      return;
    }

    if (this.visibilityApplied === nextVisible) {
      return;
    }

    // Update optimistically before awaiting so concurrent calls (e.g. rapid
    // right-clicks: close-menu → open-menu in the same microtask batch) see
    // the correct intended state and don't short-circuit erroneously.
    this.visibilityApplied = nextVisible;
    await invokeTauri("set_native_rdp_session_visible", { sessionId, visible: nextVisible }, { scope: "FE/connector/native-rdp/visible" });
  }

  async focus(): Promise<void> {
    const sessionId = await this.getSessionIdOrNull();
    if (!sessionId) {
      return;
    }

    await invokeTauri("focus_native_rdp_session", { sessionId }, { scope: "FE/connector/native-rdp/focus" });
  }

  close(): void {
    this.connectionStateEmitter.emit({ phase: "closing", stage: "closing" });
    this.closedBeforeConnect = true;
    this.readiness.fail(this.readinessCycle, new Error("Native RDP connection closed"));
    this.finalStateLocked = true;
    this.latestState = {
      state: "closed",
      detail: "Native RDP 原生宿主会话已关闭。",
    };

    const sessionId = this.sessionId ?? this.requestedSessionId;
    if (sessionId) {
      invokeTauriBackground("set_native_rdp_session_visible", {
        sessionId,
        visible: false,
      }, { scope: "FE/connector/native-rdp/visible" });

      void invokeTauri("close_native_rdp_session", {
        sessionId,
      }, { scope: "FE/connector/native-rdp/close" }).catch((error) => {
        logger.error("FE/connector/native-rdp/close", "Failed to close native RDP session", getErrorMessage(error));
      });
    }

    this.cleanupListeners();
    this.sessionId = null;
    this.visibilityRefCount = 0;
    this.visibilityApplied = null;
  }

  private emitState(payload: NativeRdpStatePayload) {
    if (this.finalStateLocked && !FINAL_NATIVE_STATES.includes(payload.state)) {
      return;
    }

    if (["hidden", "visible", "focused", "connected"].includes(payload.state)) {
      this.everConnected = true;
    }

    if (FINAL_NATIVE_STATES.includes(payload.state)) {
      this.finalStateLocked = true;
    }

    this.latestState = payload;
    if (["connected", "visible", "hidden", "focused"].includes(payload.state)) {
      this.readiness.mark(this.readinessCycle, "remote");
      if (this.readiness.has(this.readinessCycle, NATIVE_USABLE_CHECKPOINTS)) {
        this.connectionStateEmitter.emit({ phase: "connected", stage: "steady", health: "healthy" });
      }
    } else if (["launching", "ready", "host-ready", "control-created", "mounted", "connecting"].includes(payload.state)) {
      this.connectionStateEmitter.emit({
        phase: "connecting",
        stage: payload.state === "connecting" ? "session" : "transport",
        reason: payload.detail,
      });
    } else if (payload.state === "error") {
      this.failureEmitted = true;
      this.readiness.fail(this.readinessCycle, payload.detail ?? "Native RDP failed");
      const failure = classifyConnectionFailure(this.protocol, payload.detail ?? "Native RDP failed", {
        stage: "session",
      });
      this.connectionStateEmitter.emit({
        phase: "failed",
        stage: failure.stage,
        reason: "RDP 连接失败",
        failure,
      });
    } else if (payload.state === "disconnected" || payload.state === "closed") {
      this.failureEmitted = true;
      this.readiness.fail(this.readinessCycle, payload.detail ?? "Native RDP disconnected");
      const failure = classifyConnectionFailure(this.protocol, payload.detail ?? "Native RDP disconnected", {
        stage: "steady",
        fallbackCode: "REMOTE_CLOSED",
      });
      this.connectionStateEmitter.emit({
        phase: "disconnected",
        stage: "steady",
        reason: payload.detail || "RDP 连接已断开",
        failure,
      });
    }
    this.stateHandlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        logger.error("FE/connector/native-rdp/state", "State handler failed", getErrorMessage(error));
      }
    });
  }

  private async getSessionIdOrNull(): Promise<string | null> {
    if (this.sessionId) {
      return this.sessionId;
    }

    if (this.connectPromise) {
      try {
        return await this.connectPromise;
      } catch {
        return null;
      }
    }

    return null;
  }

  private handleDisconnect(): void {
    if (this.disconnected || this.closedBeforeConnect) {
      return;
    }

    this.disconnected = true;
    this.readiness.fail(this.readinessCycle, new Error("Native RDP host closed"));
    this.finalStateLocked = true;
    invokeTauriBackground("set_native_rdp_session_visible", {
      sessionId: this.sessionId ?? this.requestedSessionId,
      visible: false,
    }, { scope: "FE/connector/native-rdp/visible" });

    if (this.latestState.state !== "error") {
      this.emitState({
        state: "closed",
        detail: "Native RDP 原生宿主会话已关闭。",
      });
    }

    this.cleanupListeners();
    this.sessionId = null;
    this.visibilityRefCount = 0;
    this.visibilityApplied = null;
    this.closeHandlers.forEach((handler) => handler());
  }

  private async ensureEventListeners(sessionId: string): Promise<void> {
    if (this.listenersReady) {
      return;
    }
    if (!this.eventListenersPromise) {
      this.eventListenersPromise = this.setupEventListeners(sessionId).catch((error) => {
        this.eventListenersPromise = null;
        throw error;
      });
    }
    await this.eventListenersPromise;
  }

  private async setupEventListeners(sessionId: string): Promise<void> {
    let stateUnlisten: UnlistenFn | null = null;
    let closeUnlisten: UnlistenFn | null = null;
    try {
      stateUnlisten = await listen<NativeRdpStatePayload>(`native-rdp-state-${sessionId}`, (event) => {
        this.emitState(event.payload);
      });

      closeUnlisten = await listen(`native-rdp-close-${sessionId}`, () => {
        this.handleDisconnect();
      });

      this.stateUnlisten = stateUnlisten;
      this.closeUnlisten = closeUnlisten;
      this.listenersReady = true;
    } catch (error) {
      stateUnlisten?.();
      closeUnlisten?.();
      throw error;
    }
  }

  private cleanupListeners(): void {
    if (this.closeUnlisten) {
      this.closeUnlisten();
      this.closeUnlisten = null;
    }

    if (this.stateUnlisten) {
      this.stateUnlisten();
      this.stateUnlisten = null;
    }

    this.listenersReady = false;
    this.eventListenersPromise = null;
  }
}
