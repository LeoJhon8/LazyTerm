import { getCurrentLocale, tCurrent } from "@/i18n";
import { useNotificationsStore } from "@/store/notifications";
import { useSettingsStore } from "@/store/settings";
import { normalizeLongCommandThresholdMinutes } from "@/store/settings-values";
import { useTabsStore } from "@/store/tabs";

interface RunningCommand {
  command?: string;
  startedAt: number;
  suppressCompletionNotification: boolean;
}

function normalizeCommandLabel(command: string) {
  const normalized = command.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const isChinese = getCurrentLocale() === "zh-CN";

  if (hours > 0) {
    return isChinese
      ? `${hours} 小时 ${minutes} 分钟`
      : `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return isChinese
      ? `${minutes} 分钟 ${seconds} 秒`
      : `${minutes}m ${seconds}s`;
  }
  return isChinese ? `${seconds} 秒` : `${seconds}s`;
}

/**
 * Tracks only explicit OSC 633 command lifecycle markers:
 * C = command execution started, D = command execution finished.
 */
export class LongCommandTracker {
  private readonly sessionId: string;
  private submittedCommand?: string;
  private runningCommand?: RunningCommand;
  private disposed = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  record(command: string) {
    if (this.disposed) {
      return;
    }
    this.submittedCommand = normalizeCommandLabel(command);
  }

  handleShellIntegration(data: string) {
    if (this.disposed) {
      return;
    }

    const markerType = data.split(";", 1)[0];
    if (markerType === "C") {
      this.startCommand();
    } else if (markerType === "D") {
      this.completeCommand();
    }
  }

  handleTuiNotification() {
    if (this.runningCommand) {
      this.runningCommand.suppressCompletionNotification = true;
    }
  }

  dispose() {
    this.disposed = true;
    this.submittedCommand = undefined;
    this.runningCommand = undefined;
  }

  private startCommand() {
    const session = this.getEligibleSession();
    if (!session) {
      this.submittedCommand = undefined;
      this.runningCommand = undefined;
      return;
    }

    this.runningCommand = {
      command: this.submittedCommand,
      startedAt: Date.now(),
      suppressCompletionNotification: false,
    };
    this.submittedCommand = undefined;
  }

  private completeCommand() {
    const runningCommand = this.runningCommand;
    this.runningCommand = undefined;
    if (!runningCommand || runningCommand.suppressCompletionNotification) {
      return;
    }

    const session = this.getEligibleSession();
    const settings = useSettingsStore.getState();
    if (!session || !settings.sshReliableNotificationEnabled) {
      return;
    }

    const completedAt = Date.now();
    const durationMs = Math.max(0, completedAt - runningCommand.startedAt);
    const thresholdMs = normalizeLongCommandThresholdMinutes(
      settings.longCommandThresholdMinutes,
    ) * 60_000;
    if (durationMs < thresholdMs) {
      return;
    }

    useNotificationsStore.getState().addNotification({
      type: "success",
      source: "terminal",
      title: tCurrent("长命令已完成"),
      message: runningCommand.command,
      details: [
        tCurrent("耗时：{duration}", { duration: formatDuration(durationMs) }),
        tCurrent("来自会话：{session}", { session: session.title }),
      ],
      target: { type: "session", sessionId: this.sessionId },
    });
  }

  private getEligibleSession() {
    const session = useTabsStore.getState().sessions.find(
      (candidate) => candidate.id === this.sessionId,
    );
    return session?.type === "ssh" && session.sshTmuxPersistenceActive !== true
      ? session
      : undefined;
  }
}
