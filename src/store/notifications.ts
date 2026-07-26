import { create } from "zustand";
import type { SettingsTab } from "@/store/settings-dialog";
import { sendSystemNotification } from "@/services/systemNotificationService";

export type NotificationType = "info" | "success" | "warning" | "error";
export type NotificationSource = "sftp" | "terminal" | "system" | "ai";
export type NotificationTarget = {
  type: "settings";
  tab: SettingsTab;
};

export interface NotificationItem {
  id: string;
  type: NotificationType;
  source: NotificationSource;
  title: string;
  message?: string;
  details?: string[];
  target?: NotificationTarget;
  createdAt: number;
  read: boolean;
}

type NotificationInput = Omit<NotificationItem, "id" | "createdAt" | "read"> & {
  id?: string;
  createdAt?: number;
  read?: boolean;
};

interface NotificationsState {
  notifications: NotificationItem[];
  addNotification: (notification: NotificationInput) => string;
  updateNotification: (id: string, updates: Partial<Omit<NotificationItem, "id">>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
}

const MAX_NOTIFICATION_COUNT = 80;

function createNotificationId() {
  return `notification-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useNotificationsStore = create<NotificationsState>()((set) => ({
  notifications: [],

  addNotification: (notification) => {
    const id = notification.id ?? createNotificationId();
    const nextNotification: NotificationItem = {
      ...notification,
      id,
      createdAt: notification.createdAt ?? Date.now(),
      read: notification.read ?? false,
    };

    set((state) => ({
      notifications: [nextNotification, ...state.notifications].slice(0, MAX_NOTIFICATION_COUNT),
    }));
    sendSystemNotification(nextNotification);

    return id;
  },

  updateNotification: (id, updates) => {
    let previousNotification: NotificationItem | undefined;
    let nextNotification: NotificationItem | undefined;

    set((state) => {
      const notifications = state.notifications.map((item) => {
        if (item.id !== id) {
          return item;
        }

        previousNotification = item;
        nextNotification = { ...item, ...updates };
        return nextNotification;
      });
      return { notifications };
    });

    if (
      previousNotification
      && nextNotification
      && (
        previousNotification.type !== nextNotification.type
        || previousNotification.title !== nextNotification.title
      )
    ) {
      sendSystemNotification(nextNotification);
    }
  },

  markAsRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((item) =>
        item.id === id ? { ...item, read: true } : item
      ),
    }));
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((item) => ({ ...item, read: true })),
    }));
  },

  clearNotifications: () => {
    set({ notifications: [] });
  },
}));
