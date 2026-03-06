import { useSlotConfigStore } from "@/store/slot-config";
import { Button } from "@/components/ui/button";
import { SessionModule } from "@/components/modules/SessionModule";
import { HistoryModule } from "@/components/modules/HistoryModule";
import { PluginsModule } from "@/components/modules/PluginsModule";
import { History, Plug, Folder } from "lucide-react";

const MODULE_COMPONENTS: Record<string, React.ComponentType> = {
  SessionModule: SessionModule,
  HistoryModule: HistoryModule,
  PluginsModule: PluginsModule,
};

const MODULE_ICONS: Record<string, React.ReactNode> = {
  SessionModule: <Folder className="h-4 w-4" />,
  HistoryModule: <History className="h-4 w-4" />,
  PluginsModule: <Plug className="h-4 w-4" />,
};

export function RightSlot() {
  const { currentConfig, setActiveModule } = useSlotConfigStore();
  const { modules, activeModule } = currentConfig.right;

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
      <div className="flex-1 overflow-hidden">
        {ActiveComponent && <ActiveComponent />}
      </div>

      {/* 模块导航栏 */}
      <div className="w-12 bg-muted flex flex-col items-center py-2 border-l">
        {modules.map((moduleId) => (
          <Button
            key={moduleId}
            variant={activeModule === moduleId ? "secondary" : "ghost"}
            size="icon"
            className="mb-2"
            onClick={() => setActiveModule("right", moduleId)}
          >
            {MODULE_ICONS[moduleId]}
          </Button>
        ))}
      </div>
    </div>
  );
}