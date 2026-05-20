import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle,
  Info,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type NotificationItem,
  type NotificationSource,
  type NotificationType,
  useNotificationsStore,
} from "@/store/notifications";
import { cn } from "@/lib/utils";

const typeConfig: Record<NotificationType, { icon: typeof Info; className: string }> = {
  success: {
    icon: CheckCircle,
    className: "text-emerald-500 bg-emerald-500/10",
  },
  error: {
    icon: XCircle,
    className: "text-red-500 bg-red-500/10",
  },
  warning: {
    icon: AlertTriangle,
    className: "text-amber-500 bg-amber-500/10",
  },
  info: {
    icon: Info,
    className: "text-sky-500 bg-sky-500/10",
  },
};

const sourceLabels: Record<NotificationSource, string> = {
  sftp: "SFTP",
  terminal: "Terminal",
  system: "System",
  ai: "AI CLI",
};

function formatNotificationTime(timestamp: number) {
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (deltaSeconds < 60) return "刚刚";

  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes} 分钟前`;

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours} 小时前`;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function NotificationIcon({ item }: { item: NotificationItem }) {
  const Icon = item.source === "sftp" ? UploadCloud : typeConfig[item.type].icon;

  return (
    <span
      className={cn(
        "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
        typeConfig[item.type].className,
      )}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const markAsRead = useNotificationsStore((state) => state.markAsRead);

  return (
    <button
      type="button"
      className={cn(
        "flex w-full gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent/60",
        !item.read && "bg-accent/35",
      )}
      onClick={() => markAsRead(item.id)}
    >
      <NotificationIcon item={item} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
          {!item.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
        </span>
        {item.message && (
          <span className="block truncate text-xs text-muted-foreground">{item.message}</span>
        )}
        {item.details && item.details.length > 0 && (
          <span className="block max-h-12 space-y-0.5 overflow-hidden text-xs text-muted-foreground">
            {item.details.slice(0, 3).map((detail) => (
              <span key={detail} className="block truncate">
                {detail}
              </span>
            ))}
          </span>
        )}
        <span className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span>{sourceLabels[item.source]}</span>
          <span>{formatNotificationTime(item.createdAt)}</span>
        </span>
      </span>
    </button>
  );
}

export function NotificationCenter() {
  const notifications = useNotificationsStore((state) => state.notifications);
  const markAllAsRead = useNotificationsStore((state) => state.markAllAsRead);
  const clearNotifications = useNotificationsStore((state) => state.clearNotifications);

  const unreadCount = notifications.filter((item) => !item.read).length;
  const visibleUnreadCount = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="window-titlebar__control window-titlebar__control--neutral relative"
          aria-label={unreadCount > 0 ? `通知，${unreadCount} 条未读` : "通知"}
        >
          <Bell className="h-3.5 w-3.5" />
          {unreadCount > 0 && (
            <span className="absolute right-2 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 text-destructive-foreground">
              {visibleUnreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">通知中心</div>
            {unreadCount > 0 && (
              <div className="text-xs text-muted-foreground">{`${unreadCount} 条未读通知`}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              onClick={markAllAsRead}
              disabled={unreadCount === 0}
              aria-label="全部标记已读"
            >
              <CheckCheck className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              onClick={clearNotifications}
              disabled={notifications.length === 0}
              aria-label="清空通知"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-1.5">
          {notifications.length > 0 ? (
            <div className="space-y-1">
              {notifications.map((item) => (
                <NotificationRow key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
              <Bell className="h-8 w-8 opacity-60" />
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
