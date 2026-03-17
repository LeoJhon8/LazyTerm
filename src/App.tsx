import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/store/settings";
import { useSlotConfigStore } from "@/store/slot-config";
import { useTabsStore } from "@/store/tabs";
import { TerminalView } from "@/components/terminal/TerminalView";
import { RemoteDesktopView } from "@/components/terminal/RemoteDesktopView";
import { SlotManager } from "@/components/layout/SlotManager";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
    backgroundImageUiMode,
    backgroundBlur,
    backgroundOpacity,
    uiOpacity,
    customCSS,
  } = useSettingsStore();

  const { currentConfig: slotConfig } = useSlotConfigStore();
  const { closeAllSessions, connectionError, clearConnectionError, activeSessionId, sessions } = useTabsStore();
  const leftSlotCollapsed = slotConfig.left.collapsed;
  const rightSlotCollapsed = slotConfig.right.collapsed;
  const effectiveBottomPanelHeight = Math.round(bottomPanelHeight * 0.7);
  const hasBackgroundImage = backgroundImageEnabled && !!backgroundImage;
  const shouldDisableUiBlur = hasBackgroundImage && backgroundImageUiMode === "clear";

  const customStyleRef = useRef<HTMLStyleElement | null>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const shouldHideQuickCmdBar = activeSession?.type === "rdp";
  const effectiveBottomRowHeight = shouldHideQuickCmdBar || bottomPanelCollapsed ? 0 : effectiveBottomPanelHeight;

  // 应用关闭时清空所有会话
  useEffect(() => {
    const handleBeforeUnload = () => {
      closeAllSessions();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [closeAllSessions]);

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

  // 同步布局设置到 CSS 变量（含模块收起状态与迁移监听）
  useEffect(() => {
    const root = document.documentElement;
    
    // 过滤掉 SettingsModule 的左侧实际可见模块
    const leftModulesCount = slotConfig.left.modules.filter(m => m !== 'SettingsModule').length;
    const rightModulesCount = slotConfig.right.modules.length;

    // 左侧：全局隐藏=0, 无业务模块=56(仅图标栏), 模块收起=56, 正常=面板宽度
    const lw = leftPanelCollapsed ? 0 : (leftModulesCount === 0 || leftSlotCollapsed ? 56 : leftPanelWidth);
    // 右侧：全局隐藏=0, 无模块=0, 模块收起=56, 正常=面板宽度
    const rw = rightPanelCollapsed || rightModulesCount === 0 ? 0 : (rightSlotCollapsed ? 56 : rightPanelWidth);
    
    root.style.setProperty("--lw", `${lw}px`);
    root.style.setProperty("--rw", `${rw}px`);
    root.style.setProperty("--th", `${topPanelCollapsed ? 0 : topPanelHeight}px`);
    root.style.setProperty("--bh", `${effectiveBottomRowHeight}px`);
  }, [
    leftPanelWidth, rightPanelWidth, topPanelHeight, bottomPanelHeight,
    leftPanelCollapsed, rightPanelCollapsed, topPanelCollapsed, bottomPanelCollapsed,
    leftSlotCollapsed, rightSlotCollapsed,
    activeSession?.type,
    slotConfig.left.modules, slotConfig.right.modules,
    effectiveBottomPanelHeight,
    effectiveBottomRowHeight // 监听模块列表变化，触发布局重算
  ]);

  // 同步外观自定义到 CSS 变量
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ui-opacity", `${uiOpacity / 100}`);
    root.style.setProperty(
      "--panel-backdrop-filter",
      shouldDisableUiBlur ? "none" : "blur(20px) saturate(140%)"
    );
    root.style.setProperty(
      "--panel-strong-backdrop-filter",
      shouldDisableUiBlur ? "none" : "blur(24px) saturate(150%)"
    );
    root.style.setProperty(
      "--panel-rail-backdrop-filter",
      shouldDisableUiBlur ? "none" : "blur(18px) saturate(150%)"
    );
    root.style.setProperty(
      "--terminal-backdrop-filter",
      shouldDisableUiBlur ? "none" : "blur(24px) saturate(150%)"
    );
  }, [uiOpacity, shouldDisableUiBlur]);

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
      className="app-shell relative h-screen w-screen overflow-hidden bg-background text-foreground"
      style={{
        display: "grid",
        gridTemplateAreas: `
          "left mid-top    right"
          "left mid-main   right"
          "left mid-bottom right"
        `,
        gridTemplateColumns: `var(--lw, ${leftPanelCollapsed ? 0 : (slotConfig.left.modules.filter(m => m !== 'SettingsModule').length === 0 || leftSlotCollapsed ? 56 : leftPanelWidth)}px) 1fr var(--rw, ${rightPanelCollapsed || slotConfig.right.modules.length === 0 ? 0 : (rightSlotCollapsed ? 56 : rightPanelWidth)}px)`,
        gridTemplateRows: `var(--th, ${topPanelCollapsed ? 0 : topPanelHeight}px) 1fr var(--bh, ${effectiveBottomRowHeight}px)`,
      }}
    >
      <div
        aria-hidden="true"
        className="app-backdrop-orb"
        style={{
          top: "-8%",
          left: "-6%",
          width: "32vw",
          height: "32vw",
          minWidth: "320px",
          minHeight: "320px",
          background: "var(--app-gradient-a)",
        }}
      />
      <div
        aria-hidden="true"
        className="app-backdrop-orb"
        style={{
          right: "-10%",
          bottom: "-12%",
          width: "34vw",
          height: "34vw",
          minWidth: "340px",
          minHeight: "340px",
          background: "var(--app-gradient-b)",
        }}
      />

      {/* 背景图片层 */}
      {hasBackgroundImage && (
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
      <section
        id="slot-mid-main"
        className="relative z-0 min-h-0 min-w-0 overflow-hidden"
        style={{
          gridArea: "mid-main",
        }}
      >
        {activeSession?.type === "rdp" ? <RemoteDesktopView key={activeSession.id} /> : <TerminalView />}
      </section>

      <AlertDialog open={!!connectionError} onOpenChange={(open) => !open && clearConnectionError()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {connectionError?.sessionType === "ssh"
                ? "SSH 连接失败"
                : connectionError?.sessionType === "rdp"
                  ? "远程桌面连接失败"
                  : "终端连接失败"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {connectionError
                ? `${connectionError.sessionTarget || `会话“${connectionError.sessionTitle}”`} 未能建立连接。${connectionError.summary}`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {connectionError ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-2xl border border-border/60 bg-background/45 px-4 py-3 text-muted-foreground">
                <div className="font-medium text-foreground">建议排查</div>
                <ul className="mt-2 space-y-1.5 pl-5">
                  {connectionError.guidance.map((item) => (
                    <li key={item} className="list-disc">{item}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-border/60 bg-black/25 px-4 py-3 text-xs leading-6 text-muted-foreground">
                <div className="font-medium text-foreground">技术详情</div>
                <div className="mt-1 break-all">{connectionError.technicalDetails}</div>
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogAction onClick={clearConnectionError}>知道了</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default App;