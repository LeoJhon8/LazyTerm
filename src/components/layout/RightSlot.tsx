import { useEffect } from "react";
import { useSlotConfigStore } from "@/store/slot-config";
import { useTabsStore } from "@/store/tabs";
import { Button } from "@/components/ui/button";
import { SessionModule } from "@/components/modules/SessionModule";
import { HistoryModule } from "@/components/modules/HistoryModule";
import { History, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

const MODULE_COMPONENTS: Record<string, React.ComponentType> = {
  SessionModule: SessionModule,
  HistoryModule: HistoryModule,
};

const MODULE_ICONS: Record<string, React.ReactNode> = {
  SessionModule: <Folder className="h-6 w-6" />,
  HistoryModule: <History className="h-6 w-6" />,
};

export function RightSlot() {
  const { t } = useI18n();
  const { currentConfig, setActiveModule, toggleSlotCollapse, setActiveAndExpand, setSlotCollapsed } = useSlotConfigStore();
  const { focusSessionId, sessions } = useTabsStore();
  const { modules, activeModule, collapsed } = currentConfig.right;
  const focusSession = sessions.find((session) => session.id === focusSessionId);
  const isRdpActive = focusSession?.type === "rdp" || focusSession?.type === "vnc";

  useEffect(() => {
    if (isRdpActive && activeModule === "HistoryModule" && !collapsed) {
      setSlotCollapsed("right", true);
    }
  }, [isRdpActive, activeModule, collapsed, setSlotCollapsed]);

  if (modules.length === 0) {
    return (
      <div className="module-empty">
        <div className="module-empty-card">
          <History className="h-5 w-5" />
          <p className="text-sm font-medium text-foreground">{t("右侧面板为空")}</p>
          <p className="text-xs">{t("可以将历史或会话模块放到右侧，分担主视图信息。")}</p>
        </div>
      </div>
    );
  }

  const ActiveComponent = MODULE_COMPONENTS[activeModule];

  return (
    <div className="h-full flex">
      {/* 模块内容区 */}
      {!collapsed && modules.length > 0 && (
        <div className="flex-1 overflow-hidden transition-all duration-300 animate-in slide-in-from-right-2">
          {ActiveComponent && <ActiveComponent />}
        </div>
      )}

      {/* 模块导航栏 */}
      <div className="panel-rail activity-rail border-l">
        {modules.map((moduleId) => (
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
              if (isRdpActive && moduleId === "HistoryModule") {
                return;
              }

              if (collapsed) {
                setActiveAndExpand("right", moduleId);
              } else {
                if (activeModule === moduleId) {
                  toggleSlotCollapse("right");
                } else {
                  setActiveModule("right", moduleId);
                }
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
