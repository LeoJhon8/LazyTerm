import { useEffect } from "react";
import { X } from "lucide-react";
import { useSettingsStore } from "@/store/settings";
import { useSlotConfigStore } from "@/store/slot-config";
import { Button } from "@/components/ui/button";
import { TopSlot } from "@/components/layout/TopSlot";
import { BottomSlot } from "@/components/layout/BottomSlot";
import { countValidModules } from "@/components/layout/SideSlot";
import { getValidActivityModules } from "@/components/layout/activity-registry";
import { useTabsStore } from "@/store/tabs";
import { useViewMode } from "@/hooks/useViewMode";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { cn } from "@/lib/utils";
import { isAiConfigured, useAiConfigStore } from "@/store/ai";

export function SlotManager() {
  const {
    leftPanelWidth,
    rightPanelWidth,
    topPanelHeight,
    bottomPanelHeight,
    topPanelCollapsed,
    bottomPanelCollapsed,
    uiOpacity,
    backgroundImageEnabled,
    backgroundImage,
    quickCommandDisplayMode,
  } = useSettingsStore();
  const { currentConfig, setSlotCollapsed } = useSlotConfigStore();
  const aiConfigured = useAiConfigStore(isAiConfigured);
  const { focusSessionId, sessions } = useTabsStore();
  const { isFocus } = useViewMode();
  const effectiveBottomPanelHeight = quickCommandDisplayMode === "panel"
    ? Math.max(112, bottomPanelHeight * 3)
    : Math.round(bottomPanelHeight * 0.7);
  const focusSession = sessions.find((session) => session.id === focusSessionId);
  const shouldHideQuickCmdBar = focusSession?.type === "rdp" || focusSession?.type === "vnc";
  const isRdpActive = shouldHideQuickCmdBar;
  const effectiveFooterHeight = shouldHideQuickCmdBar || bottomPanelCollapsed ? "0px" : `${effectiveBottomPanelHeight}px`;

  const panelOpacityStyle = backgroundImageEnabled && backgroundImage
    ? { backgroundColor: `color-mix(in srgb, var(--color-background) ${uiOpacity}%, transparent)` }
    : {};

  const leftValidCount = countValidModules(currentConfig.left.modules, aiConfigured);
  const rightValidCount = countValidModules(currentConfig.right.modules, aiConfigured);
  const hideLeft = isFocus || leftValidCount === 0;
  const hideRight = isFocus || rightValidCount === 0;
  const hideBottom = isFocus;

  useEffect(() => {
    if (!isRdpActive) return;

    for (const side of ["left", "right"] as const) {
      const slot = currentConfig[side];
      if (slot.activeModule === "HistoryModule" && !slot.collapsed) {
        setSlotCollapsed(side, true);
      }
    }
  }, [currentConfig, isRdpActive, setSlotCollapsed]);

  const getActivityPanelWidth = (side: "left" | "right") => {
    const slot = currentConfig[side];
    const hidden = side === "left" ? hideLeft : hideRight;
    const activeDefinition = getValidActivityModules([slot.activeModule], aiConfigured)[0];

    if (hidden || slot.collapsed || !activeDefinition) {
      return 0;
    }

    return side === "left" ? leftPanelWidth : rightPanelWidth;
  };

  const openLeftPanelWidth = getActivityPanelWidth("left");
  const openRightPanelWidth = getActivityPanelWidth("right");

  const renderActivityPanel = (side: "left" | "right") => {
    const slot = currentConfig[side];
    const activeDefinition = getValidActivityModules([slot.activeModule], aiConfigured)[0];
    const hidden = side === "left" ? hideLeft : hideRight;

    if (hidden || slot.collapsed || !activeDefinition) {
      return null;
    }

    const Component = activeDefinition.component;
    const width = side === "left" ? leftPanelWidth : rightPanelWidth;

    return (
      <aside
        id={`slot-${side}`}
        className={cn(
          "activity-panel-overlay panel-surface",
          side === "left"
            ? "activity-panel-overlay--left border-r animate-in slide-in-from-left-2"
            : "activity-panel-overlay--right border-l animate-in slide-in-from-right-2",
        )}
        style={{
          width: `${width}px`,
          ...panelOpacityStyle,
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="activity-panel-close"
          aria-label="关闭模块面板"
          onClick={() => setSlotCollapsed(side, true)}
        >
          <X className="h-4 w-4" />
        </Button>
        <Component />
        <ResizeHandle side={side} />
      </aside>
    );
  };

  return (
    <>
      {renderActivityPanel("left")}

      <header
        id="slot-mid-top"
        className="panel-surface-strong relative z-10 overflow-hidden border-b transition-all duration-300"
        style={{
          gridArea: "mid-top",
          height: topPanelCollapsed ? "0px" : `${topPanelHeight}px`,
          marginLeft: openLeftPanelWidth ? `${openLeftPanelWidth}px` : undefined,
          marginRight: openRightPanelWidth ? `${openRightPanelWidth}px` : undefined,
          ...panelOpacityStyle,
        }}
      >
        <TopSlot />
      </header>

      {!hideBottom && (
        <footer
          id="slot-mid-bottom"
          className="panel-surface-strong relative z-10 overflow-hidden border-t transition-all duration-300"
          style={{
            gridArea: "mid-bottom",
            height: effectiveFooterHeight,
            marginLeft: openLeftPanelWidth ? `${openLeftPanelWidth}px` : undefined,
            marginRight: openRightPanelWidth ? `${openRightPanelWidth}px` : undefined,
            ...panelOpacityStyle,
          }}
        >
          <BottomSlot />
        </footer>
      )}

      {renderActivityPanel("right")}
    </>
  );
}
