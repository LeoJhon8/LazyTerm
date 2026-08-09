import { useEffect } from "react";
import { useSlotConfigStore } from "@/store/slot-config";
import { useTabsStore } from "@/store/tabs";
import { Button } from "@/components/ui/button";
import { getValidActivityModules } from "@/components/layout/activity-registry";
import { cn } from "@/lib/utils";
import { isAiConfigured, useAiConfigStore } from "@/store/ai";

interface SideSlotProps {
  side: "left" | "right";
}

export function SideSlot({ side }: SideSlotProps) {
  const {
    currentConfig,
    setActiveModule,
    toggleSlotCollapse,
    setActiveAndExpand,
    setSlotCollapsed,
  } = useSlotConfigStore();
  const { focusSessionId, sessions } = useTabsStore();
  const aiConfigured = useAiConfigStore(isAiConfigured);
  const { modules, activeModule, collapsed } = currentConfig[side];
  const focusSession = sessions.find((session) => session.id === focusSessionId);
  const isRdpActive = focusSession?.type === "rdp" || focusSession?.type === "vnc";
  const validModules = getValidActivityModules(modules, aiConfigured);

  useEffect(() => {
    if (isRdpActive && activeModule === "HistoryModule" && !collapsed) {
      setSlotCollapsed(side, true);
    }
  }, [isRdpActive, activeModule, collapsed, setSlotCollapsed, side]);

  if (validModules.length === 0) {
    return null;
  }

  const activeDefinition = getValidActivityModules([activeModule], aiConfigured)[0];
  const ActiveComponent = activeDefinition?.component;
  const isLeft = side === "left";

  const renderRail = (borderClass: string, activeClass: string) => (
    <div className={cn("panel-rail activity-rail", borderClass)}>
      {validModules.map((module) => (
        <Button
          key={module.id}
          variant="ghost"
          size="icon"
          className={cn(
            "activity-button w-full rounded-none! hover:bg-transparent! [&_svg]:size-6",
            activeModule === module.id && "activity-button-active",
            activeModule === module.id && collapsed && activeClass,
          )}
          onClick={() => {
            if (isRdpActive && module.id === "HistoryModule") return;
            if (collapsed) {
              setActiveAndExpand(side, module.id);
            } else if (activeModule === module.id) {
              toggleSlotCollapse(side);
            } else {
              setActiveModule(side, module.id);
            }
          }}
        >
          {module.icon}
        </Button>
      ))}
    </div>
  );

  return (
    <div className="h-full flex">
      {isLeft && renderRail("border-r", "activity-button-active-left")}

      {!collapsed && ActiveComponent && (
        <div
          className={cn(
            "flex-1 overflow-hidden transition-all duration-300",
            isLeft ? "animate-in slide-in-from-left-2" : "animate-in slide-in-from-right-2",
          )}
        >
          <ActiveComponent />
        </div>
      )}

      {!isLeft && renderRail("border-l", "activity-button-active-right")}
    </div>
  );
}

export { countValidModules } from "@/components/layout/activity-registry";
