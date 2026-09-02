import { tCurrent } from "@/i18n";
import { useNotificationsStore } from "@/store/notifications";
import { useSettingsStore } from "@/store/settings";
import { useTabsStore } from "@/store/tabs";

const MAX_NOTIFICATION_MESSAGE_LENGTH = 240;

function normalizeOsc9Message(value: string) {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= MAX_NOTIFICATION_MESSAGE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_NOTIFICATION_MESSAGE_LENGTH - 3)}...`;
}

export function handleSshOsc9Notification(sessionId: string, payload: string) {
  if (!useSettingsStore.getState().sshReliableNotificationEnabled) {
    return false;
  }

  const session = useTabsStore.getState().sessions.find((candidate) => candidate.id === sessionId);
  if (
    session?.type !== "ssh"
    || session.sshTmuxPersistenceActive === true
  ) {
    return false;
  }

  const message = normalizeOsc9Message(payload);
  if (!message) {
    return false;
  }

  useNotificationsStore.getState().addNotification({
    type: "info",
    source: "terminal",
    title: tCurrent("SSH 可靠通知"),
    message,
    details: [tCurrent("来自会话：{session}", { session: session.title })],
    target: { type: "session", sessionId },
  });
  return true;
}
