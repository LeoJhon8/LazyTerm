import type { ConnectionStateEvent } from "@/types/terminal";
import { logger } from "@/lib/logger";

export class ConnectionStateEmitter {
  private handlers = new Set<(event: ConnectionStateEvent) => void>();
  private latest: ConnectionStateEvent = { phase: "idle" };
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
    this.latest = event;
    this.handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        logger.error(this.scope, "Connection state handler failed", { error });
      }
    });
  }
}
