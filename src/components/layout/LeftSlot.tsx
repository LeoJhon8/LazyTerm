import { useEffect, useState } from "react";
import { useSlotConfigStore } from "@/store/slot-config";
import { useTabsStore } from "@/store/tabs";
import { Button } from "@/components/ui/button";
import { SessionModule } from "@/components/modules/SessionModule";
import { HistoryModule } from "@/components/modules/HistoryModule";
import { SlotConfigDialog } from "@/components/dialogs/SlotConfigDialog";
import { Folder, Settings, History } from "lucide-react";
import { cn } from "@/lib/utils";

const MODULE_COMPONENTS: Record<string, React.ComponentType> = {
  SessionModule: SessionModule,
  HistoryModule: HistoryModule,
};

const MODULE_ICONS: Record<string, React.ReactNode> = {
  SessionModule: <Folder className="h-6 w-6" />,
  SettingsModule: <Settings className="h-6 w-6" />,
  HistoryModule: <History className="h-6 w-6" />,
};

export function LeftSlot() {
  const { currentConfig, setActiveModule, toggleSlotCollapse, setActiveAndExpand, setSlotCollapsed } = useSlotConfigStore();
  const { activeSessionId, sessions } = useTabsStore();
  const { modules, activeModule, collapsed } = currentConfig.left;
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const isRdpActive = activeSession?.type === "rdp" || activeSession?.type === "vnc";

  useEffect(() => {
    if (isRdpActive && activeModule === "HistoryModule" && !collapsed) {
      setSlotCollapsed("left", true);
    }
  }, [isRdpActive, activeModule, collapsed, setSlotCollapsed]);

  if (modules.length === 0) {
    return (
      <div className="module-empty">
        <div className="module-empty-card">
          <Settings className="h-5 w-5" />
          <p className="text-sm font-medium text-foreground">左侧面板为空</p>
          <p className="text-xs">在设置中添加模块后，这里会显示工作区能力。</p>
        </div>
      </div>
    );
  }

  const ActiveComponent = MODULE_COMPONENTS[activeModule];

  // 过滤掉 SettingsModule，因为我们单独处理它
  const displayModules = modules.filter(moduleId => moduleId !== 'SettingsModule');

  return (
    <div className="h-full flex">
      {/* 模块导航栏 */}
      <div className="panel-rail activity-rail border-r">
        {displayModules.map((moduleId) => (
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
              if (isRdpActive && moduleId === "HistoryModule") {
                return;
              }

              if (collapsed) {
                setActiveAndExpand("left", moduleId);
              } else {
                if (activeModule === moduleId) {
                  toggleSlotCollapse("left");
                } else {
                  setActiveModule("left", moduleId);
                }
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
            className="activity-button mt-auto w-full rounded-none! hover:bg-transparent! [&_svg]:size-6"
            onClick={() => setShowSettingsDialog(true)}
          >
            <Settings className="h-6 w-6" />
          </Button>
        }
      </div>

      {/* 模块内容区 - 只有当 displayModules 不为空且未折叠时才渲染 */}
      {!collapsed && displayModules.length > 0 && (
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