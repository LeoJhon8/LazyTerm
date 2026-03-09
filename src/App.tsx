import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/store/settings";
import { TerminalView } from "@/components/terminal/TerminalView";
import { SlotManager } from "@/components/layout/SlotManager";

function App() {
  const { 
    leftPanelWidth,
    rightPanelWidth,
    topPanelHeight,
    bottomPanelHeight,
    leftPanelCollapsed,
    rightPanelCollapsed,
    topPanelCollapsed,
    bottomPanelCollapsed,
    appBackgroundColor,
    backgroundImageEnabled,
    backgroundImage,
    backgroundBlur,
    backgroundOpacity,
    uiOpacity,
    customCSS,
  } = useSettingsStore();

  const customStyleRef = useRef<HTMLStyleElement | null>(null);

  // 动态处理全局背景色和暗色模式跟班
  useEffect(() => {
    const root = document.documentElement;
    // 移除之前的强制覆盖
    root.style.removeProperty("--color-background");
    root.style.removeProperty("--background");

    const isSystemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = appBackgroundColor === "dark" || (appBackgroundColor === "system" && isSystemDark);

    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [appBackgroundColor]);

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

  // 同步外观自定义到 CSS 变量
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ui-opacity", `${uiOpacity / 100}`);
  }, [uiOpacity]);

  // 动态注入自定义 CSS
  useEffect(() => {
    if (!customStyleRef.current) {
      const style = document.createElement("style");
      style.id = "lazy-terminal-custom-css";
      document.head.appendChild(style);
      customStyleRef.current = style;
    }
    customStyleRef.current.textContent = customCSS;

    return () => {
      if (customStyleRef.current) {
        customStyleRef.current.textContent = "";
      }
    };
  }, [customCSS]);

  return (
    <div 
      id="lazy-terminal-root"
      className="h-screen w-screen overflow-hidden bg-background text-foreground relative"
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
      {/* 背景图片层 */}
      {backgroundImageEnabled && backgroundImage && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            zIndex: 0,
            backgroundImage: `url(${backgroundImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            opacity: backgroundOpacity / 100,
            filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : undefined,
          }}
        />
      )}

      {/* 内容层 — 确保在背景之上 */}
      <SlotManager />
      <TerminalView />
    </div>
  );
}

export default App;