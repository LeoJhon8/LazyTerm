import type { Terminal } from "@xterm/xterm";
import { getCurrentLocale, tCurrent } from "@/i18n";
import { useNotificationsStore } from "@/store/notifications";
import { useSettingsStore } from "@/store/settings";
import {
  normalizeLongCommandIdleSeconds,
  normalizeLongCommandThresholdMinutes,
} from "@/store/settings-values";
import { parseTerminalCommandLine } from "./terminal-command-line";

interface PendingCommand {
  command: string;
  startedAt: number;
  markedLong: boolean;
  lastOutputAt: number | null;
}

interface LongCommandTrackerOptions {
  terminal: Terminal;
  getSessionTitle: () => string;
}

const PROMPT_SETTLE_DELAY_MS = 300;
const MIN_PROMPT_DETECTION_DELAY_MS = 250;

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
  private readonly terminal: Terminal;
  private readonly getSessionTitle: () => string;
  private pending: PendingCommand | null = null;
  private longThresholdTimer: number | null = null;
  private promptSettleTimer: number | null = null;
  private idleCompletionTimer: number | null = null;
  private shellCommandRunning = false;
  private disposed = false;
  private readonly unsubscribeSettings: () => void;

  constructor({ terminal, getSessionTitle }: LongCommandTrackerOptions) {
    this.terminal = terminal;
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
    if (this.disposed || !normalizedCommand) {
      return;
    }

    if (this.pending) {
      this.completePending(submittedAt);
    }

    this.pending = {
      command: normalizedCommand,
      startedAt: submittedAt,
      markedLong: false,
      lastOutputAt: null,
    };
    this.clearPromptSettleTimer();
    this.clearIdleCompletionTimer();
    this.scheduleLongThresholdCheck();
  }

  handleShellIntegration(data: string) {
    const markerType = data.split(";", 1)[0];
    if (markerType === "C" && this.pending) {
      this.shellCommandRunning = true;
      return;
    }
    if (markerType === "D") {
      this.shellCommandRunning = false;
      this.completePending(Date.now());
    }
  }

  handleTerminalWriteParsed() {
    if (this.disposed || !this.pending) {
      return;
    }

    if (this.pending.markedLong) {
      this.pending.lastOutputAt = Date.now();
      this.scheduleIdleCompletionCheck();
    }

    this.clearPromptSettleTimer();
    this.promptSettleTimer = window.setTimeout(() => {
      this.promptSettleTimer = null;
      this.completeFromVisiblePrompt();
    }, PROMPT_SETTLE_DELAY_MS);
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.unsubscribeSettings();
    this.clearLongThresholdTimer();
    this.clearPromptSettleTimer();
    this.clearIdleCompletionTimer();
    this.shellCommandRunning = false;
    this.pending = null;
  }

  private completeFromVisiblePrompt() {
    const pending = this.pending;
    if (!pending || this.shellCommandRunning) {
      return;
    }

    const promptDetectionAllowedAt = pending.startedAt + MIN_PROMPT_DETECTION_DELAY_MS;
    if (Date.now() < promptDetectionAllowedAt) {
      this.promptSettleTimer = window.setTimeout(() => {
        this.promptSettleTimer = null;
        this.completeFromVisiblePrompt();
      }, promptDetectionAllowedAt - Date.now());
      return;
    }

    const buffer = this.terminal.buffer.active;
    if (buffer.type !== "normal") {
      return;
    }

    const cursorLine = buffer.getLine(buffer.baseY + buffer.cursorY);
    if (!cursorLine) {
      return;
    }

    const parsed = parseTerminalCommandLine(cursorLine.translateToString(true));
    if (parsed.commandStartX > 0 && parsed.command.length === 0) {
      this.completePending(Date.now());
    }
  }

  private completePending(completedAt: number) {
    const pending = this.pending;
    if (!pending) {
      return;
    }

    this.pending = null;
    this.shellCommandRunning = false;
    this.clearLongThresholdTimer();
    this.clearPromptSettleTimer();
    this.clearIdleCompletionTimer();

    const settings = useSettingsStore.getState();
    const durationMs = Math.max(0, completedAt - pending.startedAt);
    const thresholdMs =
      normalizeLongCommandThresholdMinutes(settings.longCommandThresholdMinutes) * 60_000;
    if (
      !settings.longCommandNotificationEnabled
      || (!pending.markedLong && durationMs < thresholdMs)
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
        pending.lastOutputAt = null;
        this.clearIdleCompletionTimer();
      }
      return;
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
    if (
      !pending
      || !pending.markedLong
      || pending.lastOutputAt === null
      || !settings.longCommandNotificationEnabled
    ) {
      return;
    }

    const idleMs = normalizeLongCommandIdleSeconds(settings.longCommandIdleSeconds) * 1000;
    const remainingMs = idleMs - (Date.now() - pending.lastOutputAt);
    if (remainingMs <= 0) {
      this.completePending(Date.now());
      return;
    }

    this.idleCompletionTimer = window.setTimeout(() => {
      this.idleCompletionTimer = null;
      if (this.pending === pending) {
        this.completePending(Date.now());
      }
    }, remainingMs);
  }

  private clearLongThresholdTimer() {
    if (this.longThresholdTimer !== null) {
      window.clearTimeout(this.longThresholdTimer);
      this.longThresholdTimer = null;
    }
  }

  private clearPromptSettleTimer() {
    if (this.promptSettleTimer !== null) {
      window.clearTimeout(this.promptSettleTimer);
      this.promptSettleTimer = null;
    }
  }

  private clearIdleCompletionTimer() {
    if (this.idleCompletionTimer !== null) {
      window.clearTimeout(this.idleCompletionTimer);
      this.idleCompletionTimer = null;
    }
  }
}
