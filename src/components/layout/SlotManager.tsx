import { useSettingsStore } from "@/store/settings";
import { LeftSlot } from "@/components/layout/LeftSlot";
import { RightSlot } from "@/components/layout/RightSlot";
import { TopSlot } from "@/components/layout/TopSlot";
import { BottomSlot } from "@/components/layout/BottomSlot";
import { ResizeHandle } from "@/components/layout/ResizeHandle";

export function SlotManager() {
  const {
    leftPanelCollapsed,
    rightPanelCollapsed,
    topPanelHeight,
    bottomPanelHeight,
    topPanelCollapsed,
    bottomPanelCollapsed,
    uiOpacity,
    backgroundImageEnabled,
    backgroundImage,
  } = useSettingsStore();

  // 当有背景图片时，使面板半透明
  const panelOpacityStyle = backgroundImageEnabled && backgroundImage
    ? { backgroundColor: `color-mix(in srgb, var(--color-background) ${uiOpacity}%, transparent)` }
    : {};

  return (
    <>
      {/* 左侧插槽 - 宽度由 CSS Grid 列宽 (--lw) 控制 */}
      <aside
        id="slot-left"
        className="border-r border-border transition-all duration-300 overflow-hidden"
        style={{
          gridArea: "left",
          gridRow: "1 / 4",
          width: leftPanelCollapsed ? "0px" : "100%",
          ...panelOpacityStyle,
          position: "relative",
        }}
      >
        
        <LeftSlot />
        {!leftPanelCollapsed && <ResizeHandle side="left" />}
      </aside>

      {/* 顶部插槽 */}
      <header
        id="slot-mid-top"
        className="border-b border-border transition-all duration-300 overflow-hidden"
        style={{
          gridArea: "mid-top",
          height: topPanelCollapsed ? "0px" : `${topPanelHeight}px`,
          ...panelOpacityStyle,
        }}
      >
        <TopSlot />
      </header>

      {/* 底部插槽 */}
      <footer
        id="slot-mid-bottom"
        className="relative z-10 border-t border-border transition-all duration-300 overflow-hidden"
        style={{
          gridArea: "mid-bottom",
          height: bottomPanelCollapsed ? "0px" : `${bottomPanelHeight}px`,
          ...panelOpacityStyle,
        }}
      >
        <BottomSlot />
      </footer>

      {/* 右侧插槽 - 宽度由 CSS Grid 列宽 (--rw) 控制 */}
      <aside
        id="slot-right"
        className="border-l border-border transition-all duration-300 overflow-hidden"
        style={{
          gridArea: "right",
          gridRow: "1 / 4",
          width: rightPanelCollapsed ? "0px" : "100%",
          ...panelOpacityStyle,
          position: "relative",
        }}
      >
        <RightSlot />
        {!rightPanelCollapsed && <ResizeHandle side="right" />}
      </aside>
    </>
  );
}
