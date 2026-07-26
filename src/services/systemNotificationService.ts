import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { logger } from "@/lib/logger";

export interface SystemNotificationPayload {
  title: string;
  message?: string;
  details?: string[];
}

const MAX_SYSTEM_NOTIFICATION_BODY_LENGTH = 1_000;
let permissionPromise: Promise<boolean> | null = null;

function buildNotificationBody(notification: SystemNotificationPayload) {
  const body = [
    notification.message?.trim(),
    ...((notification.details ?? []).map((detail) => detail.trim())),
  ]
    .filter((line): line is string => !!line)
    .join("\n");

  if (body.length <= MAX_SYSTEM_NOTIFICATION_BODY_LENGTH) {
    return body || undefined;
  }

  return `${body.slice(0, MAX_SYSTEM_NOTIFICATION_BODY_LENGTH - 3)}...`;
}

async function ensureNotificationPermission() {
  if (!isTauri()) {
    return false;
  }

  if (!permissionPromise) {
    permissionPromise = (async () => {
      if (await isPermissionGranted()) {
        return true;
      }

      return (await requestPermission()) === "granted";
    })().catch((error) => {
      logger.warn(
        "FE/system-notification/permission",
        "Failed to obtain system notification permission",
        { error }
      );
      return false;
    });
  }

  return permissionPromise;
}

export function sendSystemNotification(notification: SystemNotificationPayload) {
  void ensureNotificationPermission().then((permissionGranted) => {
    if (!permissionGranted) {
      return;
    }

    try {
      sendNotification({
        title: notification.title,
        body: buildNotificationBody(notification),
      });
    } catch (error) {
      logger.warn(
        "FE/system-notification/send",
        "Failed to send system notification",
        { error }
      );
    }
  });
}
