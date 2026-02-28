import { useSettingsStore } from "@/store/settings";
import { LeftSlot } from "./LeftSlot";
import { RightSlot } from "./RightSlot";
import { TopSlot } from "./TopSlot";
import { BottomSlot } from "./BottomSlot";

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
        className="absolute left-0 top-0 bottom-0 z-10 bg-background border-r border-border transition-all duration-300"
        style={{
          width: leftPanelCollapsed ? "0px" : `${leftPanelWidth}px`,
          visibility: leftPanelCollapsed ? "hidden" : "visible",
        }}
      >
        <LeftSlot />
      </aside>

      {/* 顶部插槽 */}
      <header
        id="slot-mid-top"
        className="absolute left-0 right-0 top-0 z-10 bg-background border-b border-border transition-all duration-300"
        style={{
          height: topPanelCollapsed ? "0px" : `${topPanelHeight}px`,
          visibility: topPanelCollapsed ? "hidden" : "visible",
          marginLeft: leftPanelCollapsed ? "0px" : `${leftPanelWidth}px`,
          marginRight: rightPanelCollapsed ? "0px" : `${rightPanelWidth}px`,
        }}
      >
        <TopSlot />
      </header>

      {/* 底部插槽 */}
      <footer
        id="slot-mid-bottom"
        className="absolute left-0 right-0 bottom-0 z-10 bg-background border-t border-border transition-all duration-300"
        style={{
          height: bottomPanelCollapsed ? "0px" : `${bottomPanelHeight}px`,
          visibility: bottomPanelCollapsed ? "hidden" : "visible",
          marginLeft: leftPanelCollapsed ? "0px" : `${leftPanelWidth}px`,
          marginRight: rightPanelCollapsed ? "0px" : `${rightPanelWidth}px`,
        }}
      >
        <BottomSlot />
      </footer>

      {/* 右侧插槽 */}
      <aside
        id="slot-right"
        className="absolute right-0 top-0 bottom-0 z-10 bg-background border-l border-border transition-all duration-300"
        style={{
          width: rightPanelCollapsed ? "0px" : `${rightPanelWidth}px`,
          visibility: rightPanelCollapsed ? "hidden" : "visible",
        }}
      >
        <RightSlot />
      </aside>
    </>
  );
}