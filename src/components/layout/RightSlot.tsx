import { useSlotConfigStore } from "@/store/slot-config";
import { Button } from "@/components/ui/button";
import { SessionModule } from "@/components/modules/SessionModule";
import { HistoryModule } from "@/components/modules/HistoryModule";
import { History, Folder } from "lucide-react";
import { cn } from "@/lib/utils";

const MODULE_COMPONENTS: Record<string, React.ComponentType> = {
  SessionModule: SessionModule,
  HistoryModule: HistoryModule,
};

const MODULE_ICONS: Record<string, React.ReactNode> = {
  SessionModule: <Folder className="h-4 w-4" />,
  HistoryModule: <History className="h-4 w-4" />,
};

export function RightSlot() {
  const { currentConfig, setActiveModule, toggleSlotCollapse, setSlotCollapsed } = useSlotConfigStore();
  const { modules, activeModule, collapsed } = currentConfig.right;

  if (modules.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>未配置模块</p>
      </div>
    );
  }

  const ActiveComponent = MODULE_COMPONENTS[activeModule];

  return (
    <div className="h-full flex">
      {/* 模块内容区 */}
      {!collapsed && (
        <div className="flex-1 overflow-hidden transition-all duration-300 animate-in slide-in-from-right-2">
          {ActiveComponent && <ActiveComponent />}
        </div>
      )}

      {/* 模块导航栏 */}
      <div className="w-12 bg-muted flex flex-col items-center py-2 border-l">
        {modules.map((moduleId) => (
          <Button
            key={moduleId}
            variant={activeModule === moduleId && !collapsed ? "secondary" : "ghost"}
            size="icon"
            className={cn("mb-2 transition-all", activeModule === moduleId && !collapsed && "bg-secondary")}
            onClick={() => {
              if (activeModule === moduleId) {
                toggleSlotCollapse("right");
              } else {
                setActiveModule("right", moduleId);
                setSlotCollapsed("right", false);
              }
            }}
          >
            {MODULE_ICONS[moduleId]}
          </Button>
        ))}
      </div>
    </div>
  );
}