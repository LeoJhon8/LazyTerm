import { useState } from "react";
import { useSlotConfigStore } from "@/store/slot-config";
import { Button } from "@/components/ui/button";
import { SessionModule } from "@/components/modules/SessionModule";
import { HistoryModule } from "@/components/modules/HistoryModule";
import { PluginsModule } from "@/components/modules/PluginsModule";
import { SlotConfigDialog } from "@/components/dialogs/SlotConfigDialog";
import { Folder, Settings, History, Plug } from "lucide-react";
import { cn } from "@/lib/utils";

const MODULE_COMPONENTS: Record<string, React.ComponentType> = {
  SessionModule: SessionModule,
  HistoryModule: HistoryModule,
  PluginsModule: PluginsModule,
};

const MODULE_ICONS: Record<string, React.ReactNode> = {
  SessionModule: <Folder className="h-4 w-4" />,
  SettingsModule: <Settings className="h-4 w-4" />,
  HistoryModule: <History className="h-4 w-4" />,
  PluginsModule: <Plug className="h-4 w-4" />,
};

export function LeftSlot() {
  const { currentConfig, setActiveModule, toggleSlotCollapse, setSlotCollapsed } = useSlotConfigStore();
  const { modules, activeModule, collapsed } = currentConfig.left;
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  console.log("Current Modules in Tauri:", modules); 
  if (modules.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>未配置模块</p>
      </div>
    );
  }

  const ActiveComponent = MODULE_COMPONENTS[activeModule];

  // 过滤掉 SettingsModule，因为我们单独处理它
  const displayModules = modules.filter(moduleId => moduleId !== 'SettingsModule');

  return (
    <div className="h-full flex">
      {/* 模块导航栏 */}
      <div className="w-12 bg-muted flex flex-col items-center py-2 border-r">
        {displayModules.map((moduleId) => (
          <Button
            key={moduleId}
            variant={activeModule === moduleId && !collapsed ? "secondary" : "ghost"}
            size="icon"
            className={cn("mb-2 transition-all", activeModule === moduleId && !collapsed && "bg-secondary")}
            onClick={() => {
              if (activeModule === moduleId) {
                toggleSlotCollapse("left");
              } else {
                setActiveModule("left", moduleId);
                setSlotCollapsed("left", false);
              }
            }}
          >
            {MODULE_ICONS[moduleId]}
          </Button>
        ))}
        
        {/* 设置按钮 - 总是显示在最后 */}
        {
          <Button
            variant="ghost"
            size="icon"
            className="mb-2 mt-auto"
            onClick={() => setShowSettingsDialog(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        }
      </div>

      {/* 模块内容区 */}
      {!collapsed && (
        <div className="flex-1 overflow-hidden transition-all duration-300 animate-in slide-in-from-left-2">
          {ActiveComponent && <ActiveComponent />}
        </div>
      )}
      
      {/* 设置弹窗 */}
      <SlotConfigDialog 
        open={showSettingsDialog} 
        onOpenChange={setShowSettingsDialog} 
      />
    </div>
  );
}