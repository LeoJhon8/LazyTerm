import type {
  ConnectionFailure,
  ConnectionStateEvent,
  SessionConnector,
  SessionProtocol,
} from "@/types/terminal";
import { logger } from "@/lib/logger";
import { normalizeConnectionStateEvent } from "@/connectors/ConnectionStateEmitter";
import { classifyConnectionFailure } from "./connectionErrors";

const MAX_RECONNECT_ATTEMPTS = 6;
const MAX_CONCURRENT_RECONNECTS = 2;
const STABLE_CONNECTION_RESET_MS = 30_000;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000] as const;

export interface RegisterConnectionOptions {
  sessionId: string;
  protocol: SessionProtocol;
  connector: SessionConnector;
  initialAttempt: number;
  reconnecting: boolean;
  preserveRetryCount?: boolean;
  onState: (event: ConnectionStateEvent) => void;
  onReconnect: () => Promise<void>;
}

interface ManagedConnection extends RegisterConnectionOptions {
  generation: number;
  attempt: number;
  attemptCounted: boolean;
  failureReported: boolean;
  retryCount: number;
  retryTimer: number | null;
  stableTimer: number | null;
  retryQueued: boolean;
  unsubscribe: () => void;
}

export class ConnectionSupervisor {
  private readonly entries = new Map<string, ManagedConnection>();
  private readonly generations = new Map<string, number>();
  private activeReconnects = 0;
  private networkOnline = typeof navigator === "undefined" ? true : navigator.onLine;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  register(options: RegisterConnectionOptions): number {
    const previous = this.entries.get(options.sessionId);
    const generation = (this.generations.get(options.sessionId) ?? 0) + 1;
    this.generations.set(options.sessionId, generation);

    if (previous) {
      this.cleanupEntry(previous, false);
    }

    const entry: ManagedConnection = {
      ...options,
      generation,
      attempt: options.initialAttempt,
      attemptCounted: false,
      failureReported: false,
      retryCount: options.preserveRetryCount === false ? 0 : (previous?.retryCount ?? 0),
      retryTimer: null,
      stableTimer: null,
      retryQueued: false,
      unsubscribe: () => undefined,
    };

    this.entries.set(options.sessionId, entry);
    const unsubscribe = options.connector.onConnectionState((event) => {
      this.handleConnectorState(options.sessionId, generation, event);
    });

    if (this.isCurrent(options.sessionId, generation)) {
      entry.unsubscribe = unsubscribe;
    } else {
      unsubscribe();
    }

    return generation;
  }

  unregister(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) {
      this.cleanupEntry(entry, true);
      this.entries.delete(sessionId);
    }
    this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1);
  }

  isCurrent(sessionId: string, generation: number): boolean {
    return this.entries.get(sessionId)?.generation === generation;
  }

  getGeneration(sessionId: string): number | undefined {
    return this.entries.get(sessionId)?.generation;
  }

  hasReportedFailure(sessionId: string, generation: number): boolean {
    const entry = this.entries.get(sessionId);
    return entry?.generation === generation && entry.failureReported;
  }

  resetRetryState(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      return;
    }

    this.clearRetryTimer(entry);
    entry.retryQueued = false;
    entry.retryCount = 0;
  }

  reportFailure(
    sessionId: string,
    generation: number,
    error: unknown,
    phase: "failed" | "disconnected" = "failed",
  ): void {
    if (!this.isCurrent(sessionId, generation)) {
      return;
    }
    this.handleConnectorState(sessionId, generation, {
      phase,
      stage: phase === "failed" ? "transport" : "steady",
      technicalDetails: error instanceof Error ? error.message : String(error),
    });
  }

  private handleConnectorState(
    sessionId: string,
    generation: number,
    sourceEvent: ConnectionStateEvent,
  ): void {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.generation !== generation) {
      return;
    }

    let event = normalizeConnectionStateEvent(sourceEvent);
    if (entry.reconnecting && event.phase === "idle") {
      return;
    }
    if (!entry.attemptCounted && event.phase !== "idle" && event.phase !== "closing") {
      entry.attempt += 1;
      entry.attemptCounted = true;
    }

    if (entry.reconnecting && (event.phase === "connecting" || event.phase === "authenticating")) {
      event = {
        ...event,
        phase: "reconnecting",
        health: "degraded",
      };
    }

    if (event.phase === "connecting" || event.phase === "authenticating" || event.phase === "connected") {
      entry.failureReported = false;
    } else if (event.phase === "failed" || event.phase === "disconnected") {
      entry.failureReported = true;
    }

    let failure = event.failure;
    if (!failure && (event.phase === "failed" || event.phase === "disconnected")) {
      failure = classifyConnectionFailure(
        entry.protocol,
        event.technicalDetails ?? event.reason ?? "Remote connection closed",
        {
          stage: event.stage,
          fallbackCode: event.phase === "disconnected" ? "REMOTE_CLOSED" : "UNKNOWN",
        },
      );
    }

    const normalizedEvent: ConnectionStateEvent = {
      ...event,
      failure,
      generation,
      attempt: entry.attempt,
      terminal: false,
      technicalDetails: event.technicalDetails ?? failure?.technicalDetails,
    };

    if (normalizedEvent.phase === "connected") {
      entry.reconnecting = false;
      this.clearRetryTimer(entry);
      entry.retryQueued = false;
      this.scheduleStableReset(entry);
    } else if (normalizedEvent.phase === "reconnecting") {
      this.clearStableTimer(entry);
    } else if (normalizedEvent.phase === "failed" || normalizedEvent.phase === "disconnected") {
      this.clearStableTimer(entry);
    }

    if (
      (normalizedEvent.phase === "failed" || normalizedEvent.phase === "disconnected")
      && failure
    ) {
      if (this.scheduleReconnect(entry, failure)) {
        return;
      }
      entry.onState({
        ...normalizedEvent,
        terminal: true,
      });
      return;
    }

    entry.onState(normalizedEvent);
  }

  private scheduleReconnect(entry: ManagedConnection, failure: ConnectionFailure): boolean {
    if (
      !this.isRemoteProtocol(entry.protocol)
      || !failure.retryable
      || entry.retryCount >= MAX_RECONNECT_ATTEMPTS
    ) {
      return false;
    }

    if (entry.retryTimer !== null || entry.retryQueued) {
      return true;
    }

    const delayIndex = Math.min(entry.retryCount, RECONNECT_DELAYS_MS.length - 1);
    const baseDelay = RECONNECT_DELAYS_MS[delayIndex];
    const jitter = 0.8 + Math.random() * 0.4;
    const delayMs = Math.round(baseDelay * jitter);
    entry.retryCount += 1;
    entry.reconnecting = true;

    const waitsForNetwork = this.requiresNetwork(entry.protocol) && !this.networkOnline;
    const retryAt = waitsForNetwork ? undefined : Date.now() + delayMs;
    entry.onState({
      phase: "reconnecting",
      stage: failure.stage,
      health: "degraded",
      terminal: false,
      generation: entry.generation,
      attempt: entry.attempt,
      retryAt,
    });

    if (waitsForNetwork) {
      entry.retryQueued = true;
      return true;
    }

    entry.retryTimer = window.setTimeout(() => {
      entry.retryTimer = null;
      if (!this.isCurrent(entry.sessionId, entry.generation)) {
        return;
      }
      entry.retryQueued = true;
      this.drainReconnectQueue();
    }, delayMs);
    return true;
  }

  private drainReconnectQueue(): void {
    if (this.activeReconnects >= MAX_CONCURRENT_RECONNECTS) {
      return;
    }

    const candidates = [...this.entries.values()]
      .filter((entry) => entry.retryQueued && (this.networkOnline || !this.requiresNetwork(entry.protocol)))
      .sort((left, right) => left.retryCount - right.retryCount);

    for (const entry of candidates) {
      if (this.activeReconnects >= MAX_CONCURRENT_RECONNECTS) {
        break;
      }
      if (!this.isCurrent(entry.sessionId, entry.generation)) {
        continue;
      }

      entry.retryQueued = false;
      this.activeReconnects += 1;
      void entry.onReconnect()
        .catch((error) => {
          logger.error("FE/connection-supervisor/reconnect", "Automatic reconnect failed", {
            sessionId: entry.sessionId,
            error,
          });
        })
        .finally(() => {
          this.activeReconnects = Math.max(0, this.activeReconnects - 1);
          this.drainReconnectQueue();
        });
    }
  }

  private scheduleStableReset(entry: ManagedConnection): void {
    this.clearStableTimer(entry);
    entry.stableTimer = window.setTimeout(() => {
      if (this.isCurrent(entry.sessionId, entry.generation)) {
        entry.retryCount = 0;
      }
      entry.stableTimer = null;
    }, STABLE_CONNECTION_RESET_MS);
  }

  private cleanupEntry(entry: ManagedConnection, clearRetryState: boolean): void {
    entry.unsubscribe();
    this.clearRetryTimer(entry);
    this.clearStableTimer(entry);
    entry.retryQueued = false;
    if (clearRetryState) {
      entry.retryCount = 0;
    }
  }

  private clearRetryTimer(entry: ManagedConnection): void {
    if (entry.retryTimer !== null) {
      window.clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }
  }

  private clearStableTimer(entry: ManagedConnection): void {
    if (entry.stableTimer !== null) {
      window.clearTimeout(entry.stableTimer);
      entry.stableTimer = null;
    }
  }

  private isRemoteProtocol(protocol: SessionProtocol): boolean {
    return protocol === "ssh"
      || protocol === "rdp"
      || protocol === "vnc"
      || protocol === "serial"
      || protocol === "telnet";
  }

  private requiresNetwork(protocol: SessionProtocol): boolean {
    return protocol !== "serial" && protocol !== "local" && protocol !== "ai-cli";
  }

  private readonly handleOnline = () => {
    this.networkOnline = true;
    for (const entry of this.entries.values()) {
      if (entry.retryQueued) {
        entry.onState({
          phase: "reconnecting",
          stage: entry.connector.protocol === "serial" ? "transport" : "resolving",
          health: "degraded",
          terminal: false,
          generation: entry.generation,
          attempt: entry.attempt,
          retryAt: Date.now(),
        });
      }
    }
    this.drainReconnectQueue();
  };

  private readonly handleOffline = () => {
    this.networkOnline = false;
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      this.drainReconnectQueue();
    }
  };
}
