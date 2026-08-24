import { useEffect, useRef, useState } from "react";
import { History, LoaderCircle, Plus, Radio, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useI18n } from "@/i18n";
import { IS_DESKTOP } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useTabsStore, type TerminalSession } from "@/store/tabs";
import { useNotificationsStore } from "@/store/notifications";
import { getErrorMessage } from "@/lib/errorUtils";
import type { SshTmuxSessionInfo } from "@/types/terminal";

const NEW_TMUX_SESSION = "__new_tmux_session__";

type TmuxCheckState =
  | { status: "idle" | "checking" }
  | { status: "available"; version?: string; sessions: SshTmuxSessionInfo[] }
  | { status: "unavailable" | "failed" };

function isSameSshTarget(left: TerminalSession, right: TerminalSession): boolean {
  const leftConfig = left.config?.sshConfig;
  const rightConfig = right.config?.sshConfig;
  if (!leftConfig || !rightConfig) return false;

  return leftConfig.host.trim().toLowerCase() === rightConfig.host.trim().toLowerCase()
    && leftConfig.port === rightConfig.port
    && leftConfig.username === rightConfig.username;
}

function isTmuxSessionUsedByAnotherTab(
  currentSession: TerminalSession,
  sessions: TerminalSession[],
  tmuxSessionName: string,
): boolean {
  return sessions.some((candidate) =>
    candidate.id !== currentSession.id
    && candidate.type === "ssh"
    && isSameSshTarget(currentSession, candidate)
    && candidate.sshTmuxSessionName === tmuxSessionName
    && (
      candidate.sshTmuxPersistenceEnabled === true
      || candidate.sshTmuxPersistenceActive === true
    )
  );
}

function createTmuxSessionName(sessionId: string): string {
  return `lazyterm_${sessionId}_${Date.now().toString(36)}`;
}

function formatTmuxTimestamp(timestamp: number, locale: string): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

interface SshBackgroundModeMenuItemProps {
  sessionId: string;
  onRequestEnable: (sessionId: string) => void;
  onRequestEndTmux: (sessionId: string) => void;
}

export function SshBackgroundModeMenuItem({
  sessionId,
  onRequestEnable,
  onRequestEndTmux,
}: SshBackgroundModeMenuItemProps) {
  const { t } = useI18n();
  const session = useTabsStore((state) =>
    state.sessions.find((candidate) => candidate.id === sessionId)
  );
  const updateSession = useTabsStore((state) => state.updateSession);
  const connector = session?.type === "ssh" && session.connector?.protocol === "ssh"
    ? session.connector
    : null;
  const enabled = session?.sshBackgroundModeEnabled === true;
  const tmuxActive = session?.sshTmuxPersistenceActive === true;
  const connected = connector?.isConnected === true;

  if (!IS_DESKTOP || !session || !connector) {
    return null;
  }

  const requestToggle = () => {
    if (enabled) {
      connector.setBackgroundMode?.(false);
      connector.setTmuxPersistenceEnabled?.(false);
      updateSession(session.id, {
        sshBackgroundModeEnabled: false,
        sshTmuxPersistenceEnabled: false,
      });
      return;
    }
    if (connected) {
      onRequestEnable(session.id);
    }
  };

  const label = enabled
    ? t("关闭后台模式（保留远端任务）")
    : t("开启此会话的后台模式");

  return (
    <>
      <ContextMenuItem
        className="py-1 text-xs"
        disabled={!enabled && !connected}
        onSelect={requestToggle}
      >
        <Radio className={enabled ? "mr-2 h-3.5 w-3.5 text-emerald-500" : "mr-2 h-3.5 w-3.5"} />
        {label}
      </ContextMenuItem>
      {tmuxActive && (
        <ContextMenuItem
          className="py-1 text-xs text-destructive focus:text-destructive"
          disabled={!connected}
          onSelect={() => onRequestEndTmux(session.id)}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          {t("结束远端后台会话…")}
        </ContextMenuItem>
      )}
    </>
  );
}

interface SshBackgroundModeDialogProps {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SshBackgroundModeDialog({
  sessionId,
  open,
  onOpenChange,
}: SshBackgroundModeDialogProps) {
  const { locale, t } = useI18n();
  const sessions = useTabsStore((state) => state.sessions);
  const updateSession = useTabsStore((state) => state.updateSession);
  const [tmuxCheck, setTmuxCheck] = useState<TmuxCheckState>({ status: "idle" });
  const [tmuxSelected, setTmuxSelected] = useState(false);
  const [tmuxChoice, setTmuxChoice] = useState(NEW_TMUX_SESSION);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const checkSequence = useRef(0);

  const session = sessionId
    ? sessions.find((candidate) => candidate.id === sessionId)
    : undefined;
  const connector = session?.type === "ssh" && session.connector?.protocol === "ssh"
    ? session.connector
    : null;

  useEffect(() => {
    const sequence = ++checkSequence.current;
    setTmuxCheck({ status: open ? "checking" : "idle" });
    setTmuxSelected(false);
    setTmuxChoice(NEW_TMUX_SESSION);
    setSelectionError(null);

    if (!open || !connector?.isConnected) {
      return;
    }

    void connector.checkTmuxCapability?.().then((capability) => {
      if (sequence !== checkSequence.current) return;
      if (capability?.available) {
        setTmuxCheck({
          status: "available",
          version: capability.version,
          sessions: capability.sessions,
        });
      } else {
        setTmuxCheck({ status: "unavailable" });
      }
    }).catch(() => {
      if (sequence === checkSequence.current) {
        setTmuxCheck({ status: "failed" });
      }
    });
  }, [connector, open, sessionId]);

  if (!IS_DESKTOP || !session || !connector) {
    return null;
  }

  const enableForSession = () => {
    const useTmux = tmuxCheck.status === "available" && tmuxSelected;
    let tmuxSessionName = session.sshTmuxSessionName ?? `lazyterm_${session.id}`;
    if (useTmux) {
      tmuxSessionName = tmuxChoice === NEW_TMUX_SESSION
        ? createTmuxSessionName(session.id)
        : tmuxChoice;
      const latestSessions = useTabsStore.getState().sessions;
      const latestCurrentSession = latestSessions.find((candidate) => candidate.id === session.id) ?? session;
      if (isTmuxSessionUsedByAnotherTab(latestCurrentSession, latestSessions, tmuxSessionName)) {
        setSelectionError(t("所选 tmux 会话已被另一个 LazyTerm 标签页使用，请选择其他会话。"));
        return;
      }
    }

    setSelectionError(null);
    connector.setTmuxSessionName?.(tmuxSessionName);
    connector.setTmuxPersistenceEnabled?.(useTmux);
    connector.setBackgroundMode?.(true);
    updateSession(session.id, {
      sshBackgroundModeEnabled: true,
      sshTmuxPersistenceEnabled: useTmux,
      sshTmuxSessionName: tmuxSessionName,
    });
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("开启当前 SSH 会话的后台模式？")}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3 text-left leading-6">
            <span className="block">
              {t("开启后，LazyTerm 会在窗口保持打开期间持续维护当前 SSH 会话。")}
            </span>
            <span className="block font-medium text-foreground/90">
              {t("请注意以下限制和风险：")}
            </span>
            <span className="block">• {t("后台会话仍会消耗本机网络以及远端 CPU、内存等资源。")}</span>
            <span className="block">• {t("隐藏的会话可能正在等待确认、授权或其他交互输入。")}</span>
            <span className="block">• {t("大量持续输出会占用终端回滚缓冲区，较早的内容可能被丢弃。")}</span>
            <span className="block">• {t("未使用 tmux 时，SSH 断线后无法恢复原进程和 TUI 状态。")}</span>

            <span className="block rounded-md border border-border/60 bg-muted/30 p-3 text-foreground/90">
              {tmuxCheck.status === "checking" && (
                <span className="flex items-center gap-2">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  {t("正在检测当前服务器是否支持 tmux…")}
                </span>
              )}
              {tmuxCheck.status === "available" && (
                <span className="block space-y-3">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <Checkbox
                      className="mt-1"
                      checked={tmuxSelected}
                      onCheckedChange={(checked) => {
                        setTmuxSelected(checked === true);
                        setSelectionError(null);
                      }}
                    />
                    <span>
                      <span className="block font-medium">{t("使用 tmux 创建或恢复可恢复会话")}</span>
                      <span className="block text-xs text-muted-foreground">
                        {tmuxCheck.version
                          ? t("检测到 {version}。选择将在当前会话下次连接或重连时生效。", { version: tmuxCheck.version })
                          : t("检测到 tmux。选择将在当前会话下次连接或重连时生效。")}
                      </span>
                    </span>
                  </label>

                  {tmuxSelected && (
                    <span className="block space-y-2 border-t border-border/60 pt-3">
                      <span className="block text-xs text-muted-foreground">
                        {tmuxCheck.sessions.length > 0
                          ? t("发现 {count} 个可恢复会话，请选择要恢复的会话或创建新会话。", { count: tmuxCheck.sessions.length })
                          : t("未发现已有 LazyTerm 会话，将创建一个新会话。")}
                      </span>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/70 bg-background/60 p-2.5 hover:bg-accent/40">
                        <input
                          type="radio"
                          name={`tmux-session-${session.id}`}
                          className="mt-1 accent-primary"
                          checked={tmuxChoice === NEW_TMUX_SESSION}
                          onChange={() => {
                            setTmuxChoice(NEW_TMUX_SESSION);
                            setSelectionError(null);
                          }}
                        />
                        <Plus className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <span>
                          <span className="block font-medium">{t("创建新的 tmux 会话")}</span>
                          <span className="block text-xs text-muted-foreground">
                            {t("创建一个与其他标签页相互独立的后台会话。")}
                          </span>
                        </span>
                      </label>

                      {tmuxCheck.sessions.length > 0 && (
                        <span className="block max-h-48 space-y-2 overflow-y-auto pr-1">
                          {tmuxCheck.sessions.map((tmuxSession) => {
                            const usedByAnotherTab = isTmuxSessionUsedByAnotherTab(
                              session,
                              sessions,
                              tmuxSession.name,
                            );
                            return (
                              <label
                                key={tmuxSession.name}
                                className={cn(
                                  "flex items-start gap-2 rounded-md border border-border/70 bg-background/60 p-2.5",
                                  usedByAnotherTab
                                    ? "cursor-not-allowed opacity-55"
                                    : "cursor-pointer hover:bg-accent/40",
                                )}
                              >
                                <input
                                  type="radio"
                                  name={`tmux-session-${session.id}`}
                                  className="mt-1 accent-primary"
                                  checked={tmuxChoice === tmuxSession.name}
                                  disabled={usedByAnotherTab}
                                  onChange={() => {
                                    setTmuxChoice(tmuxSession.name);
                                    setSelectionError(null);
                                  }}
                                />
                                <History className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                                <span className="min-w-0">
                                  <span className="block truncate font-mono text-xs font-medium text-foreground">
                                    {tmuxSession.name}
                                  </span>
                                  <span className="block text-xs text-muted-foreground">
                                    {t("上次活动 {time} · {windows} 个窗口 · {clients} 个已附着客户端", {
                                      time: formatTmuxTimestamp(
                                        tmuxSession.lastActivityAt || tmuxSession.createdAt,
                                        locale,
                                      ),
                                      windows: tmuxSession.windows,
                                      clients: tmuxSession.attachedClients,
                                    })}
                                  </span>
                                  {usedByAnotherTab && (
                                    <span className="block text-xs text-amber-600 dark:text-amber-400">
                                      {t("此会话已被另一个 LazyTerm 标签页使用")}
                                    </span>
                                  )}
                                </span>
                              </label>
                            );
                          })}
                        </span>
                      )}

                      {tmuxCheck.sessions.some((tmuxSession) => tmuxSession.attachedClients > 0) && (
                        <span className="block text-xs text-amber-600 dark:text-amber-400">
                          {t("恢复已有会话时，其他附着客户端会与当前标签页共享终端画面和输入。")}
                        </span>
                      )}
                      {selectionError && (
                        <span className="block rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                          {selectionError}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              )}
              {tmuxCheck.status === "unavailable" && (
                <span>{t("当前服务器未检测到 tmux，只能使用窗口内后台保持。")}</span>
              )}
              {tmuxCheck.status === "failed" && (
                <span>{t("无法完成 tmux 检测，只能使用窗口内后台保持。")}</span>
              )}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={tmuxCheck.status === "checking"}
            onClick={enableForSession}
          >
            {t("了解风险并为当前会话开启")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface SshEndTmuxSessionDialogProps {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SshEndTmuxSessionDialog({
  sessionId,
  open,
  onOpenChange,
}: SshEndTmuxSessionDialogProps) {
  const { t } = useI18n();
  const sessions = useTabsStore((state) => state.sessions);
  const updateSession = useTabsStore((state) => state.updateSession);
  const addNotification = useNotificationsStore((state) => state.addNotification);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const session = sessionId
    ? sessions.find((candidate) => candidate.id === sessionId)
    : undefined;
  const connector = session?.type === "ssh" && session.connector?.protocol === "ssh"
    ? session.connector
    : null;

  useEffect(() => {
    if (open) {
      setEnding(false);
      setError(null);
    }
  }, [open, sessionId]);

  if (!IS_DESKTOP || !session || !connector) {
    return null;
  }

  const endRemoteSession = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (ending) return;

    const previousBackgroundEnabled = session.sshBackgroundModeEnabled === true;
    const previousTmuxEnabled = session.sshTmuxPersistenceEnabled === true;
    setEnding(true);
    setError(null);
    connector.setTmuxPersistenceEnabled?.(false);
    connector.setBackgroundMode?.(false);
    updateSession(session.id, {
      sshBackgroundModeEnabled: false,
      sshTmuxPersistenceEnabled: false,
    });

    try {
      await connector.killTmuxSession?.();
      updateSession(session.id, { sshTmuxPersistenceActive: false });
      addNotification({
        type: "success",
        source: "terminal",
        title: t("远端后台会话已结束"),
        message: session.title,
      });
      onOpenChange(false);
    } catch (killError) {
      connector.setTmuxPersistenceEnabled?.(previousTmuxEnabled);
      connector.setBackgroundMode?.(previousBackgroundEnabled);
      updateSession(session.id, {
        sshBackgroundModeEnabled: previousBackgroundEnabled,
        sshTmuxPersistenceEnabled: previousTmuxEnabled,
        sshTmuxPersistenceActive: true,
      });
      setError(getErrorMessage(killError));
      setEnding(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!ending) onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("结束远端后台会话？")}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3 text-left leading-6">
            <span className="block">
              {t("这会终止该 tmux 会话及其中正在运行的所有命令和程序，其他附着客户端也会断开。此操作无法撤销。")}
            </span>
            {error && (
              <span className="block rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                {t("结束远端会话失败：{error}", { error })}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={ending}>{t("取消")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={ending}
            onClick={endRemoteSession}
          >
            {ending ? t("正在结束…") : t("结束远端会话")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
