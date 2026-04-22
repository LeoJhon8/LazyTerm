import { useEffect } from "react";
import { useSlotConfigStore } from "@/store/slot-config";
import { useTabsStore } from "@/store/tabs";
import { Button } from "@/components/ui/button";
import { SessionModule } from "@/components/modules/SessionModule";
import { HistoryModule } from "@/components/modules/HistoryModule";
import { Folder, History } from "lucide-react";
import { cn } from "@/lib/utils";

const MODULE_COMPONENTS: Record<string, React.ComponentType> = {
  SessionModule: SessionModule,
  HistoryModule: HistoryModule,
};

const MODULE_ICONS: Record<string, React.ReactNode> = {
  SessionModule: <Folder className="h-6 w-6" />,
  HistoryModule: <History className="h-6 w-6" />,
};

/** 计算模块列表中有对应组件/图标的有效模块数 */
function countValidModules(modules: string[]): number {
  return modules.filter(id => id in MODULE_COMPONENTS && id in MODULE_ICONS).length;
}

interface SideSlotProps {
  side: "left" | "right";
}

/** 左/右侧栏通用组件，通过 side 属性区分方向 */
export function SideSlot({ side }: SideSlotProps) {
  const { currentConfig, setActiveModule, toggleSlotCollapse, setActiveAndExpand, setSlotCollapsed } = useSlotConfigStore();
  const { focusSessionId, sessions } = useTabsStore();
  const { modules, activeModule, collapsed } = currentConfig[side];
  const focusSession = sessions.find((session) => session.id === focusSessionId);
  const isRdpActive = focusSession?.type === "rdp" || focusSession?.type === "vnc";

  // 有效模块数（有对应组件和图标的模块）
  const validCount = countValidModules(modules);

  // RDP/VNC 模式下自动收起历史模块
  useEffect(() => {
    if (isRdpActive && activeModule === "HistoryModule" && !collapsed) {
      setSlotCollapsed(side, true);
    }
  }, [isRdpActive, activeModule, collapsed, setSlotCollapsed, side]);

  // 无有效模块时隐藏
  if (validCount === 0) {
    return null;
  }

  const ActiveComponent = MODULE_COMPONENTS[activeModule];
  const isLeft = side === "left";

  return (
    <div className="h-full flex">
      {/* 左侧：图标栏在左，内容区在右 */}
      {/* 右侧：内容区在左，图标栏在右 */}
      {isLeft && (
        <div className="panel-rail activity-rail border-r">
          {modules.map((moduleId) => {
            const icon = MODULE_ICONS[moduleId];
            if (!icon) return null;
            return (
              <Button
                key={moduleId}
                variant="ghost"
                size="icon"
                className={cn(
                  "activity-button w-full rounded-none! hover:bg-transparent! [&_svg]:size-6",
                  activeModule === moduleId && "activity-button-active",
                  activeModule === moduleId && collapsed && "activity-button-active-left"
                )}
                onClick={() => {
                  if (isRdpActive && moduleId === "HistoryModule") return;
                  if (collapsed) {
                    setActiveAndExpand(side, moduleId);
                  } else if (activeModule === moduleId) {
                    toggleSlotCollapse(side);
                  } else {
                    setActiveModule(side, moduleId);
                  }
                }}
              >
                {icon}
              </Button>
            );
          })}
        </div>
      )}

      {/* 模块内容区 */}
      {!collapsed && ActiveComponent && (
        <div className={cn(
          "flex-1 overflow-hidden transition-all duration-300",
          isLeft ? "animate-in slide-in-from-left-2" : "animate-in slide-in-from-right-2"
        )}>
          <ActiveComponent />
        </div>
      )}

      {!isLeft && (
        <div className="panel-rail activity-rail border-l">
          {modules.map((moduleId) => {
            const icon = MODULE_ICONS[moduleId];
            if (!icon) return null;
            return (
              <Button
                key={moduleId}
                variant="ghost"
                size="icon"
                className={cn(
                  "activity-button w-full rounded-none! hover:bg-transparent! [&_svg]:size-6",
                  activeModule === moduleId && "activity-button-active",
                  activeModule === moduleId && collapsed && "activity-button-active-right"
                )}
                onClick={() => {
                  if (isRdpActive && moduleId === "HistoryModule") return;
                  if (collapsed) {
                    setActiveAndExpand(side, moduleId);
                  } else if (activeModule === moduleId) {
                    toggleSlotCollapse(side);
                  } else {
                    setActiveModule(side, moduleId);
                  }
                }}
              >
                {icon}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 导出有效模块计数函数供外部使用 */
export { countValidModules };
