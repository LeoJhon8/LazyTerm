import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  INativeRdpConnector,
  NativeHostRect,
  NativeRdpStatePayload,
  NativeRdpTracePayload,
  RDPConfig,
} from "@/types/terminal";
import { logger } from "@/lib/logger";
import { invokeTauri, invokeTauriBackground } from "@/services/tauri";

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (typeof error === "object" && error !== null) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "未知错误";
}

export class NativeRdpConnector implements INativeRdpConnector {
  readonly protocol = "rdp" as const;
  readonly backend = "msrdpax" as const;

  private readonly config: RDPConfig;
  private sessionId: string | null = null;
  private connectPromise: Promise<string> | null = null;
  private closedBeforeConnect = false;
  private closeUnlisten: UnlistenFn | null = null;
  private stateUnlisten: UnlistenFn | null = null;
  private traceUnlisten: UnlistenFn | null = null;
  private closeHandlers = new Set<() => void>();
  private stateHandlers = new Set<(payload: NativeRdpStatePayload) => void>();
  private traceHandlers = new Set<(payload: NativeRdpTracePayload) => void>();
  private listenersReady = false;
  private traceBuffer: NativeRdpTracePayload[] = [];
  private visibilityRefCount = 0;
  private visibilityApplied: boolean | null = null;
  private latestState: NativeRdpStatePayload = {
    state: "launching",
    detail: "正在准备 MsTscAx 原生宿主进程。",
  };

  constructor(config: RDPConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  async open(): Promise<void> {
    if (this.sessionId) {
      return;
    }

    if (!this.connectPromise) {
      this.closedBeforeConnect = false;
      this.emitTrace("info", "frontend.open", "正在请求创建 native RDP 会话");
      this.connectPromise = invokeTauri<string>("create_native_rdp_session", {
        config: {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.password,
          domain: this.config.domain,
          width: this.config.width,
          height: this.config.height,
          auto_resize: this.config.autoResize ?? true,
        },
      }, {
        scope: "FE/connector/native-rdp/open",
        logStart: true,
        logSuccess: true,
      }).then((sessionId) => {
        if (this.closedBeforeConnect) {
          invokeTauriBackground("close_native_rdp_session", { sessionId }, { scope: "FE/connector/native-rdp/close" });
          throw new Error("Native RDP session was closed before initialization completed");
        }

        this.sessionId = sessionId;
        void this.ensureEventListeners(sessionId);
        this.emitTrace("info", "frontend.open", `native 会话已创建: ${sessionId}`);
        this.emitState({
          state: "launching",
          detail: "MsTscAx sidecar 已启动，等待原生宿主状态。",
        });
        return sessionId;
      }).finally(() => {
        this.connectPromise = null;
      });
    }

    await this.connectPromise;
  }

  async onState(handler: (payload: NativeRdpStatePayload) => void): Promise<void> {
    const sessionId = await this.waitForSessionId();

    this.stateHandlers.add(handler);
    await this.ensureEventListeners(sessionId);

    handler(this.latestState);
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  onTrace(handler: (payload: NativeRdpTracePayload) => void): () => void {
    this.traceHandlers.add(handler);
    this.traceBuffer.forEach((item) => handler(item));
    return () => {
      this.traceHandlers.delete(handler);
    };
  }

  async mount(rect: NativeHostRect): Promise<void> {
    const sessionId = await this.waitForSessionId();
    const normalizedRect: NativeHostRect = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
      scaleFactor: rect.scaleFactor,
    };
    this.emitTrace(
      "info",
      "frontend.mount",
      `mount ${normalizedRect.width}x${normalizedRect.height} @ (${normalizedRect.x}, ${normalizedRect.y})`
    );
    await invokeTauri("mount_native_rdp_session", { sessionId, rect: normalizedRect }, { scope: "FE/connector/native-rdp/mount" });
  }

  async setVisible(visible: boolean): Promise<void> {
    const sessionId = await this.waitForSessionId();

    if (visible) {
      this.visibilityRefCount += 1;
    } else {
      this.visibilityRefCount = Math.max(0, this.visibilityRefCount - 1);
    }

    const nextVisible = this.visibilityRefCount > 0;
    this.emitTrace(
      "info",
      "frontend.visibility",
      `${visible ? "setVisible(true)" : "setVisible(false)"} -> refCount=${this.visibilityRefCount}, apply=${nextVisible}`,
    );

    if (this.visibilityApplied === nextVisible) {
      return;
    }

    await invokeTauri("set_native_rdp_session_visible", { sessionId, visible: nextVisible }, { scope: "FE/connector/native-rdp/visible" });
    this.visibilityApplied = nextVisible;
  }

  async focus(): Promise<void> {
    const sessionId = await this.waitForSessionId();
    this.emitTrace("info", "frontend.focus", "focus() requested");
    await invokeTauri("focus_native_rdp_session", { sessionId }, { scope: "FE/connector/native-rdp/focus" });
  }

  close(): void {
    this.closedBeforeConnect = true;

    if (this.sessionId) {
      void invokeTauri("close_native_rdp_session", {
        sessionId: this.sessionId,
      }, { scope: "FE/connector/native-rdp/close" }).catch((error) => {
        this.emitTrace("error", "frontend.close", getErrorMessage(error));
      });
    }

    this.cleanupListeners();
    this.sessionId = null;
    this.visibilityRefCount = 0;
    this.visibilityApplied = null;
  }

  private emitState(payload: NativeRdpStatePayload) {
    this.latestState = payload;
    this.stateHandlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        logger.error("FE/connector/native-rdp/state", "State handler failed", getErrorMessage(error));
      }
    });
  }

  private emitTrace(
    level: NativeRdpTracePayload["level"],
    stage: string,
    message: string,
    extra?: string,
    timestampMs = Date.now(),
  ) {
    const payload: NativeRdpTracePayload = { timestampMs, level, stage, message, extra };
    this.traceBuffer.push(payload);
    if (this.traceBuffer.length > 120) {
      this.traceBuffer.splice(0, this.traceBuffer.length - 120);
    }

    this.traceHandlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        logger.error("FE/connector/native-rdp/trace", "Trace handler failed", getErrorMessage(error));
      }
    });
  }

  private async waitForSessionId(): Promise<string> {
    if (this.sessionId) {
      return this.sessionId;
    }

    if (this.connectPromise) {
      return await this.connectPromise;
    }

    throw new Error("Native RDP session has not started opening yet");
  }

  private handleDisconnect(): void {
    if (!this.sessionId) {
      return;
    }

    this.emitState({
      state: "closed",
      detail: "Native RDP 原生宿主会话已关闭。",
    });
    this.emitTrace("warn", "frontend.disconnect", "收到 native-rdp-close 事件，会话关闭");
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

    this.stateUnlisten = await listen<NativeRdpStatePayload>(`native-rdp-state-${sessionId}`, (event) => {
      this.emitState(event.payload);
    });

    this.traceUnlisten = await listen<NativeRdpTracePayload>(`native-rdp-trace-${sessionId}`, (event) => {
      this.emitTrace(
        event.payload.level,
        event.payload.stage,
        event.payload.message,
        event.payload.extra,
        event.payload.timestampMs,
      );
    });

    this.closeUnlisten = await listen(`native-rdp-close-${sessionId}`, () => {
      this.handleDisconnect();
    });

    this.listenersReady = true;
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

    if (this.traceUnlisten) {
      this.traceUnlisten();
      this.traceUnlisten = null;
    }

    this.listenersReady = false;
  }
}