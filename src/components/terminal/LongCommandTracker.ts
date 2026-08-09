import { getCurrentLocale, tCurrent } from "@/i18n";
import { useNotificationsStore } from "@/store/notifications";
import { useSettingsStore } from "@/store/settings";
import {
  normalizeLongCommandIdleSeconds,
  normalizeLongCommandThresholdMinutes,
} from "@/store/settings-values";

interface PendingCommand {
  command: string;
  startedAt: number;
  markedLong: boolean;
  lastOutputAt: number | null;
}

interface LongCommandTrackerOptions {
  getSessionTitle: () => string;
}

function normalizeCommandLabel(command: string) {
  const normalized = command.replace(/\s+/g, " ").trim();
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

export class LongCommandTracker {
  private readonly getSessionTitle: () => string;
  private pending: PendingCommand | null = null;
  private longThresholdTimer: number | null = null;
  private idleCompletionTimer: number | null = null;
  private disposed = false;
  private readonly unsubscribeSettings: () => void;

  constructor({ getSessionTitle }: LongCommandTrackerOptions) {
    this.getSessionTitle = getSessionTitle;
    this.unsubscribeSettings = useSettingsStore.subscribe((state, previousState) => {
      if (
        state.longCommandNotificationEnabled !== previousState.longCommandNotificationEnabled
        || state.longCommandThresholdMinutes !== previousState.longCommandThresholdMinutes
        || state.longCommandIdleSeconds !== previousState.longCommandIdleSeconds
      ) {
        this.scheduleLongThresholdCheck();
        this.scheduleIdleCompletionCheck();
      }
    });
  }

  record(command: string, submittedAt = Date.now()) {
    const normalizedCommand = normalizeCommandLabel(command);
    if (this.disposed) {
      return;
    }

    const trackedCommand = normalizedCommand || this.pending?.command;
    if (this.pending) {
      this.pending = null;
      this.clearLongThresholdTimer();
      this.clearIdleCompletionTimer();
    }

    if (!trackedCommand) {
      return;
    }

    this.pending = {
      command: trackedCommand,
      startedAt: submittedAt,
      markedLong: false,
      lastOutputAt: null,
    };
    this.clearIdleCompletionTimer();
    this.scheduleLongThresholdCheck();
  }

  handleTerminalWriteParsed() {
    if (this.disposed || !this.pending) {
      return;
    }

    this.pending.lastOutputAt = Date.now();
    if (this.pending.markedLong) {
      this.scheduleIdleCompletionCheck();
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.unsubscribeSettings();
    this.clearLongThresholdTimer();
    this.clearIdleCompletionTimer();
    this.pending = null;
  }

  private completePending(completedAt: number) {
    const pending = this.pending;
    if (!pending) {
      return;
    }

    this.pending = null;
    this.clearLongThresholdTimer();
    this.clearIdleCompletionTimer();

    const settings = useSettingsStore.getState();
    const durationMs = Math.max(0, completedAt - pending.startedAt);
    const thresholdMs =
      normalizeLongCommandThresholdMinutes(settings.longCommandThresholdMinutes) * 60_000;
    if (
      !settings.longCommandNotificationEnabled
      || durationMs < thresholdMs
    ) {
      return;
    }

    useNotificationsStore.getState().addNotification({
      type: "success",
      source: "terminal",
      title: tCurrent("长命令已完成"),
      message: pending.command,
      details: [
        tCurrent("耗时：{duration}", { duration: formatDuration(durationMs) }),
        tCurrent("会话：{session}", { session: this.getSessionTitle() }),
      ],
    });
  }

  private scheduleLongThresholdCheck() {
    this.clearLongThresholdTimer();
    const pending = this.pending;
    const settings = useSettingsStore.getState();
    if (!pending || !settings.longCommandNotificationEnabled) {
      return;
    }

    const thresholdMs =
      normalizeLongCommandThresholdMinutes(settings.longCommandThresholdMinutes) * 60_000;
    const remainingMs = thresholdMs - (Date.now() - pending.startedAt);
    if (remainingMs <= 0) {
      if (!pending.markedLong) {
        pending.markedLong = true;
        this.scheduleIdleCompletionCheck();
      }
      return;
    }

    if (pending.markedLong) {
      pending.markedLong = false;
      this.clearIdleCompletionTimer();
    }

    this.longThresholdTimer = window.setTimeout(() => {
      this.longThresholdTimer = null;
      if (this.pending === pending) {
        this.scheduleLongThresholdCheck();
      }
    }, remainingMs);
  }

  private scheduleIdleCompletionCheck() {
    this.clearIdleCompletionTimer();
    const pending = this.pending;
    const settings = useSettingsStore.getState();
    const thresholdMs =
      normalizeLongCommandThresholdMinutes(settings.longCommandThresholdMinutes) * 60_000;
    if (
      !pending
      || !pending.markedLong
      || pending.lastOutputAt === null
      || pending.lastOutputAt - pending.startedAt < thresholdMs
      || !settings.longCommandNotificationEnabled
    ) {
      return;
    }

    const completedAt = pending.lastOutputAt;
    const idleMs = normalizeLongCommandIdleSeconds(settings.longCommandIdleSeconds) * 1000;
    const remainingMs = idleMs - (Date.now() - completedAt);
    if (remainingMs <= 0) {
      this.completePending(completedAt);
      return;
    }

    this.idleCompletionTimer = window.setTimeout(() => {
      this.idleCompletionTimer = null;
      if (this.pending === pending) {
        this.completePending(completedAt);
      }
    }, remainingMs);
  }

  private clearLongThresholdTimer() {
    if (this.longThresholdTimer !== null) {
      window.clearTimeout(this.longThresholdTimer);
      this.longThresholdTimer = null;
    }
  }

  private clearIdleCompletionTimer() {
    if (this.idleCompletionTimer !== null) {
      window.clearTimeout(this.idleCompletionTimer);
      this.idleCompletionTimer = null;
    }
  }
}
