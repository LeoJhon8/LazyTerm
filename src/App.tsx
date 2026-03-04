import { useEffect } from "react";
import { useSettingsStore } from "@/store/settings";
import { TerminalView } from "@/components/terminal/TerminalView";
import { SlotManager } from "@/components/layout/SlotManager";

function App() {
  const { 
    theme,
    leftPanelWidth,
    rightPanelWidth,
    topPanelHeight,
    bottomPanelHeight,
    leftPanelCollapsed,
    rightPanelCollapsed,
    topPanelCollapsed,
    bottomPanelCollapsed
  } = useSettingsStore();

  // 设置主题
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.toggle("dark", systemTheme === "dark");
    } else {
      root.classList.toggle("dark", theme === "dark");
    }
  }, [theme]);

  // 同步布局设置到 CSS 变量
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--lw", `${leftPanelCollapsed ? 0 : leftPanelWidth}px`);
    root.style.setProperty("--rw", `${rightPanelCollapsed ? 0 : rightPanelWidth}px`);
    root.style.setProperty("--th", `${topPanelCollapsed ? 0 : topPanelHeight}px`);
    root.style.setProperty("--bh", `${bottomPanelCollapsed ? 0 : bottomPanelHeight}px`);
  }, [
    leftPanelWidth, rightPanelWidth, topPanelHeight, bottomPanelHeight,
    leftPanelCollapsed, rightPanelCollapsed, topPanelCollapsed, bottomPanelCollapsed
  ]);

  return (
    <div 
      id="lazy-terminal-root"
      className="h-screen w-screen overflow-hidden bg-background text-foreground"
      style={{
        display: "grid",
        gridTemplateAreas: `
          "left mid-top    right"
          "left mid-main   right"
          "left mid-bottom right"
        `,
        gridTemplateColumns: `var(--lw, ${leftPanelCollapsed ? 0 : leftPanelWidth}px) 1fr var(--rw, ${rightPanelCollapsed ? 0 : rightPanelWidth}px)`,
        gridTemplateRows: `var(--th, ${topPanelCollapsed ? 0 : topPanelHeight}px) 1fr var(--bh, ${bottomPanelCollapsed ? 0 : bottomPanelHeight}px)`,
      }}
    >
      <SlotManager />
      <TerminalView />
    </div>
  );
}

export default App;