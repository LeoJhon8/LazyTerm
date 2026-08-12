import { logger } from "@/lib/logger";
import type {
  ConnectionQualityMode,
  ConnectionQualityPolicy,
  SessionConnector,
} from "@/types/terminal";

interface QualityEntry {
  connector: SessionConnector;
  visible: boolean;
  lastPolicyKey: string | null;
}

const QUALITY_POLICIES: Record<ConnectionQualityMode, ConnectionQualityPolicy> = {
  interactive: {
    mode: "interactive",
    priority: 100,
    targetFrameRate: 60,
    jpegQualityCap: 85,
    suspendVisuals: false,
  },
  balanced: {
    mode: "balanced",
    priority: 60,
    targetFrameRate: 30,
    jpegQualityCap: 72,
    suspendVisuals: false,
  },
  background: {
    mode: "background",
    priority: 20,
    targetFrameRate: 5,
    jpegQualityCap: 45,
    suspendVisuals: false,
  },
  suspended: {
    mode: "suspended",
    priority: 0,
    targetFrameRate: 1,
    jpegQualityCap: 25,
    suspendVisuals: true,
  },
};

export class ConnectionQualityScheduler {
  private readonly entries = new Map<string, QualityEntry>();
  private focusedSessionId: string | null = null;

  constructor() {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  register(sessionId: string, connector: SessionConnector): void {
    this.entries.set(sessionId, {
      connector,
      visible: this.entries.get(sessionId)?.visible ?? false,
      lastPolicyKey: null,
    });
    this.applySessionPolicy(sessionId);
  }

  unregister(sessionId: string): void {
    this.entries.delete(sessionId);
    if (this.focusedSessionId === sessionId) {
      this.focusedSessionId = null;
    }
  }

  setFocusedSession(sessionId: string | null): void {
    const previous = this.focusedSessionId;
    this.focusedSessionId = sessionId;
    if (previous) {
      this.applySessionPolicy(previous);
    }
    if (sessionId) {
      this.applySessionPolicy(sessionId);
    }
  }

  setSessionVisible(sessionId: string, visible: boolean): void {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.visible === visible) {
      return;
    }
    entry.visible = visible;
    this.applySessionPolicy(sessionId);
  }

  refreshSession(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) {
      entry.lastPolicyKey = null;
      this.applySessionPolicy(sessionId);
    }
  }

  private applyAllPolicies(): void {
    for (const sessionId of this.entries.keys()) {
      this.applySessionPolicy(sessionId);
    }
  }

  private applySessionPolicy(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      return;
    }

    const mode = this.resolveMode(sessionId, entry);
    const policy = QUALITY_POLICIES[mode];
    const policyKey = `${policy.mode}:${policy.targetFrameRate}:${policy.jpegQualityCap}:${policy.suspendVisuals}`;
    if (entry.lastPolicyKey === policyKey) {
      return;
    }

    entry.lastPolicyKey = policyKey;
    try {
      entry.connector.applyQualityPolicy?.(policy);
    } catch (error) {
      logger.warn("FE/connection-quality/apply", "Failed to apply connection quality policy", {
        sessionId,
        protocol: entry.connector.protocol,
        error,
      });
    }
  }

  private resolveMode(sessionId: string, entry: QualityEntry): ConnectionQualityMode {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return "suspended";
    }
    if (!entry.visible) {
      return "background";
    }
    if (sessionId === this.focusedSessionId) {
      return "interactive";
    }
    return "balanced";
  }

  private readonly handleVisibilityChange = () => {
    this.applyAllPolicies();
  };
}

export const connectionQualityScheduler = new ConnectionQualityScheduler();
