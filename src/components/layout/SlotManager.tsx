import { useSettingsStore } from "@/store/settings";
import { LeftSlot } from "@/components/layout/LeftSlot";
import { RightSlot } from "@/components/layout/RightSlot";
import { TopSlot } from "@/components/layout/TopSlot";
import { BottomSlot } from "@/components/layout/BottomSlot";

export function SlotManager() {
  const {
    leftPanelWidth,
    rightPanelWidth,
    topPanelHeight,
    bottomPanelHeight,
    leftPanelCollapsed,
    rightPanelCollapsed,
    topPanelCollapsed,
    bottomPanelCollapsed,
  } = useSettingsStore();
  

  return (
    <>
      {/* 左侧插槽 */}
      <aside
        id="slot-left"
        className="bg-background border-r border-border transition-all duration-300 overflow-hidden"
        style={{
          gridArea: "left",
          gridRow: "1 / 4",
          width: leftPanelCollapsed ? "0px" : `${leftPanelWidth}px`,
        }}
      >
        <LeftSlot />
      </aside>

      {/* 顶部插槽 */}
      <header
        id="slot-mid-top"
        className="bg-background border-b border-border transition-all duration-300 overflow-hidden"
        style={{
          gridArea: "mid-top",
          height: topPanelCollapsed ? "0px" : `${topPanelHeight}px`,
        }}
      >
        <TopSlot />
      </header>

      {/* 底部插槽 */}
      <footer
        id="slot-mid-bottom"
        className="bg-background border-t border-border transition-all duration-300 overflow-hidden"
        style={{
          gridArea: "mid-bottom",
          height: bottomPanelCollapsed ? "0px" : `${bottomPanelHeight}px`,
        }}
      >
        <BottomSlot />
      </footer>

      {/* 右侧插槽 */}
      <aside
        id="slot-right"
        className="bg-background border-l border-border transition-all duration-300 overflow-hidden"
        style={{
          gridArea: "right",
          gridRow: "1 / 4",
          width: rightPanelCollapsed ? "0px" : `${rightPanelWidth}px`,
        }}
      >
        <RightSlot />
      </aside>
    </>
  );
}