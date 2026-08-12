import type {
  ConnectionHealth,
  ConnectionStage,
  ConnectionStateEvent,
  SessionConnectionPhase,
} from "@/types/terminal";
import { logger } from "@/lib/logger";

const DEFAULT_STAGE_BY_PHASE: Record<SessionConnectionPhase, ConnectionStage> = {
  idle: "idle",
  connecting: "transport",
  authenticating: "authentication",
  connected: "steady",
  reconnecting: "transport",
  disconnected: "steady",
  failed: "transport",
  closing: "closing",
};

const DEFAULT_HEALTH_BY_PHASE: Record<SessionConnectionPhase, ConnectionHealth> = {
  idle: "unknown",
  connecting: "unknown",
  authenticating: "unknown",
  connected: "healthy",
  reconnecting: "degraded",
  disconnected: "stalled",
  failed: "stalled",
  closing: "unknown",
};

export function normalizeConnectionStateEvent(event: ConnectionStateEvent): ConnectionStateEvent {
  return {
    ...event,
    stage: event.stage ?? event.failure?.stage ?? DEFAULT_STAGE_BY_PHASE[event.phase],
    health: event.health ?? DEFAULT_HEALTH_BY_PHASE[event.phase],
    technicalDetails: event.technicalDetails ?? event.failure?.technicalDetails,
  };
}

export class ConnectionStateEmitter {
  private handlers = new Set<(event: ConnectionStateEvent) => void>();
  private latest: ConnectionStateEvent = normalizeConnectionStateEvent({ phase: "idle" });
  private readonly scope: string;

  constructor(scope: string) {
    this.scope = scope;
  }

  subscribe(handler: (event: ConnectionStateEvent) => void): () => void {
    this.handlers.add(handler);
    handler(this.latest);
    return () => this.handlers.delete(handler);
  }

  emit(event: ConnectionStateEvent): void {
    const normalizedEvent = normalizeConnectionStateEvent(event);
    this.latest = normalizedEvent;
    this.handlers.forEach((handler) => {
      try {
        handler(normalizedEvent);
      } catch (error) {
        logger.error(this.scope, "Connection state handler failed", { error });
      }
    });
  }
}
