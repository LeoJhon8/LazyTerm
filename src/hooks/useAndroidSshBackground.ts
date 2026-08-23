import { useEffect, useMemo, useRef } from "react";

import { useI18n } from "@/i18n";
import { IS_ANDROID } from "@/lib/platform";
import { ensureSystemNotificationPermission, sendSystemNotification } from "@/services/systemNotificationService";
import { invokeTauri } from "@/services/tauri";
import { useSettingsStore } from "@/store/settings";
import { useTabsStore } from "@/store/tabs";
import type { SessionConnectionPhase } from "@/types/terminal";

const ACTIVE_SSH_PHASES = new Set<SessionConnectionPhase>([
  "connecting",
  "authenticating",
  "connected",
  "reconnecting",
]);

export function useAndroidSshBackground() {
  const { t } = useI18n();
  const sessions = useTabsStore((state) => state.sessions);
  const enabled = useSettingsStore((state) => state.mobileSshBackgroundServiceEnabled);
  const previousPhases = useRef(new Map<string, SessionConnectionPhase>());

  const sshSessions = useMemo(
    () => sessions.filter((session) => session.type === "ssh"),
    [sessions],
  );
  const activeSessionCount = enabled
    ? sshSessions.filter((session) => ACTIVE_SSH_PHASES.has(session.connectionStatus.phase)).length
    : 0;
  const serviceTitle = t("SSH 后台连接");
  const serviceText = t("正在保持 {count} 个 SSH 会话", { count: activeSessionCount });

  useEffect(() => {
    if (!IS_ANDROID) return;

    if (activeSessionCount > 0) {
      void ensureSystemNotificationPermission();
    }
    void invokeTauri("set_android_ssh_session_count", {
      activeSessions: activeSessionCount,
      title: serviceTitle,
      text: serviceText,
    }, {
      scope: "FE/android-ssh-background/service",
    }).catch(() => undefined);
  }, [activeSessionCount, serviceText, serviceTitle]);

  useEffect(() => {
    if (!IS_ANDROID) return;

    const nextPhases = new Map<string, SessionConnectionPhase>();
    const appIsBackground = document.visibilityState !== "visible";

    for (const session of sshSessions) {
      const phase = session.connectionStatus.phase;
      const previousPhase = previousPhases.current.get(session.id);
      nextPhases.set(session.id, phase);

      if (!appIsBackground || !previousPhase || previousPhase === phase) continue;

      if (previousPhase === "connected" && phase === "reconnecting") {
        sendSystemNotification({
          title: t("SSH 连接已中断"),
          message: t("{name} 正在自动重连。", { name: session.title }),
        });
      } else if (previousPhase === "reconnecting" && phase === "connected") {
        sendSystemNotification({
          title: t("SSH 已重新连接"),
          message: t("{name} 已恢复连接。", { name: session.title }),
        });
      } else if (
        (previousPhase === "connected" || previousPhase === "reconnecting")
        && (phase === "failed" || phase === "disconnected")
        && session.connectionStatus.terminal
      ) {
        sendSystemNotification({
          title: t("SSH 连接已结束"),
          message: t("{name} 无法恢复连接，请返回应用检查。", { name: session.title }),
        });
      }
    }

    previousPhases.current = nextPhases;
  }, [sshSessions, t]);
}
