import { useEffect, useRef } from "react";
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
    bottomPanelCollapsed,
    backgroundImage,
    backgroundBlur,
    backgroundOpacity,
    uiOpacity,
    accentColor,
    customCSS,
  } = useSettingsStore();

  const customStyleRef = useRef<HTMLStyleElement | null>(null);

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

  // 同步外观自定义到 CSS 变量
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ui-opacity", `${uiOpacity / 100}`);

    // 强调色 — 设置为 CSS 变量供全局使用
    if (accentColor) {
      root.style.setProperty("--accent-custom", accentColor);
    } else {
      root.style.removeProperty("--accent-custom");
    }
  }, [uiOpacity, accentColor]);

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
      {backgroundImage && (
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