import { MoreHorizontal } from "lucide-react";
import { getModuleDisplayName, useI18n } from "@/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { getValidActivityModules } from "@/components/layout/activity-registry";
import { useSlotConfigStore } from "@/store/slot-config";
import { useTabsStore } from "@/store/tabs";
import { cn } from "@/lib/utils";
import { isAiConfigured, useAiConfigStore } from "@/store/ai";

const VISIBLE_ACTIVITY_LIMIT = 4;

type ActivitySide = "left" | "right";

interface ActivityEntry {
  id: string;
  side: ActivitySide;
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  active: boolean;
}

export function TitleBarActivityNav() {
  const { locale } = useI18n();
  const {
    currentConfig,
    setActiveModule,
    setActiveAndExpand,
    toggleSlotCollapse,
  } = useSlotConfigStore();
  const { focusSessionId, sessions } = useTabsStore();
  const aiConfigured = useAiConfigStore(isAiConfigured);
  const focusSession = sessions.find((session) => session.id === focusSessionId);
  const isRdpActive = focusSession?.type === "rdp" || focusSession?.type === "vnc";

  const entries: ActivityEntry[] = (["left", "right"] as const).flatMap((side) => {
    const slot = currentConfig[side];
    return getValidActivityModules(slot.modules, aiConfigured).map((module) => ({
      id: module.id,
      side,
      icon: module.icon,
      label: getModuleDisplayName(module.id, locale),
      disabled: isRdpActive && module.id === "HistoryModule",
      active: slot.activeModule === module.id && !slot.collapsed,
    }));
  });

  if (entries.length === 0) {
    return null;
  }

  const handleEntryClick = (entry: ActivityEntry) => {
    if (entry.disabled) return;

    const slot = currentConfig[entry.side];
    if (slot.collapsed) {
      setActiveAndExpand(entry.side, entry.id);
    } else if (slot.activeModule === entry.id) {
      toggleSlotCollapse(entry.side);
    } else {
      setActiveModule(entry.side, entry.id);
    }
  };

  const visibleEntries = entries.slice(0, VISIBLE_ACTIVITY_LIMIT);
  const overflowEntries = entries.slice(VISIBLE_ACTIVITY_LIMIT);

  return (
    <nav className="window-titlebar__activity" aria-label="活动入口">
      {visibleEntries.map((entry) => (
        <Button
          key={`${entry.side}-${entry.id}`}
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "window-titlebar__activity-button",
            entry.active && "window-titlebar__activity-button--active",
          )}
          disabled={entry.disabled}
          title={entry.label}
          aria-label={entry.label}
          aria-pressed={entry.active}
          onClick={() => handleEntryClick(entry)}
        >
          {entry.icon}
        </Button>
      ))}

      {overflowEntries.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="window-titlebar__activity-button"
              title="更多"
              aria-label="更多活动入口"
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="min-w-44">
            {overflowEntries.map((entry) => (
              <DropdownMenuItem
                key={`${entry.side}-${entry.id}`}
                disabled={entry.disabled}
                onClick={() => handleEntryClick(entry)}
              >
                <span className="mr-2 flex h-4 w-4 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
                  {entry.icon}
                </span>
                <span>{entry.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
