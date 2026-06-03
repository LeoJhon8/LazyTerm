import { useEffect } from "react";
import { IS_UPDATE_SUPPORTED } from "@/config/update-config";
import {
  checkForUpdate,
  type AvailableUpdateResult,
} from "@/services/updateService";
import { useNotificationsStore } from "@/store/notifications";

const STARTUP_UPDATE_CHECK_DELAY_MS = 30_000;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_UPDATE_CHECK_AT_KEY = "lazy-term-last-update-check-at";
const LAST_NOTIFIED_UPDATE_VERSION_KEY = "lazy-term-last-notified-update-version";

export function notifyUpdateAvailable(update: AvailableUpdateResult) {
  const notificationId = `update-available-${update.latestVersion}`;
  const notificationsStore = useNotificationsStore.getState();

  if (notificationsStore.notifications.some((item) => item.id === notificationId)) {
    return;
  }

  notificationsStore.addNotification({
    id: notificationId,
    type: "info",
    source: "system",
    title: "发现新版本",
    message: `LazyTerm ${update.latestVersion} 已可用，点击查看更新`,
    details: [
      `当前版本：${update.currentVersion}`,
      `最新版本：${update.latestVersion}`,
    ],
    target: {
      type: "settings",
      tab: "about",
    },
  });

  localStorage.setItem(LAST_NOTIFIED_UPDATE_VERSION_KEY, update.latestVersion);
}

export function useUpdateNotification() {
  useEffect(() => {
    if (!IS_UPDATE_SUPPORTED) {
      return;
    }

    const timer = window.setTimeout(async () => {
      const lastCheckAt = Number(localStorage.getItem(LAST_UPDATE_CHECK_AT_KEY) ?? "0");
      const now = Date.now();

      if (Number.isFinite(lastCheckAt) && now - lastCheckAt < UPDATE_CHECK_INTERVAL_MS) {
        return;
      }

      localStorage.setItem(LAST_UPDATE_CHECK_AT_KEY, String(now));

      try {
        const result = await checkForUpdate();

        if (result.status !== "available") {
          return;
        }

        const lastNotifiedVersion = localStorage.getItem(LAST_NOTIFIED_UPDATE_VERSION_KEY);

        if (lastNotifiedVersion === result.latestVersion) {
          return;
        }

        notifyUpdateAvailable(result);
      } catch {
        // 启动检查保持静默，避免网络异常打断正常使用。
      }
    }, STARTUP_UPDATE_CHECK_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);
}
