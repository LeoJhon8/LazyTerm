import { useEffect, useState } from "react";
import { useSettingsStore } from "@/store/settings";
import { useSlotConfigStore } from "@/store/slot-config";
import { useTabsStore } from "@/store/tabs";
import { getConnectionErrorPresentation } from "@/services/connectionErrorService";
import { useI18n } from "@/i18n";
import { useViewMode } from "@/hooks/useViewMode";

import { PaneContainer } from "@/components/layout/PaneContainer";
import { SlotManager } from "@/components/layout/SlotManager";
import { CustomTitleBar } from "@/components/layout/CustomTitleBar";
import { ImmersiveHoverBar } from "@/components/layout/ImmersiveHoverBar";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { ToastContainer } from "@/components/ui/toast";
import { countValidModules } from "@/components/layout/SideSlot";
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
  const { locale, t } = useI18n();
  const { isImmersive } = useViewMode();
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
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
    normalFontWeight,
    boldFontWeight,
    quickCommandDisplayMode,
  } = useSettingsStore();

  const { currentConfig: slotConfig } = useSlotConfigStore();
  const { getAllConnectors, connectionError, clearConnectionError, focusSessionId, sessions } = useTabsStore();
  const leftSlotCollapsed = slotConfig.left.collapsed;
  const rightSlotCollapsed = slotConfig.right.collapsed;
  const effectiveBottomPanelHeight = quickCommandDisplayMode === "panel"
    ? Math.max(112, bottomPanelHeight * 3)
    : Math.round(bottomPanelHeight * 0.7);
  const hasBackgroundImage = backgroundImageEnabled && !!backgroundImage;
  const shouldDisableUiBlur = hasBackgroundImage && backgroundImageUiMode === "clear";

  const focusSession = focusSessionId
    ? sessions.find(s => s.id === focusSessionId)
    : null;
  const shouldHideQuickCmdBar = !slotConfig.quickCmdBarEnabled || focusSession?.type === "rdp" || focusSession?.type === "vnc";
  const effectiveBottomRowHeight = shouldHideQuickCmdBar || bottomPanelCollapsed ? 0 : effectiveBottomPanelHeight;
  const localizedConnectionError = connectionError
    ? getConnectionErrorPresentation(connectionError.sessionType, connectionError.technicalDetails)
    : null;

  // 列宽/行高：直接同步计算（不再依赖异步 CSS 变量）
  // 沉浸模式下侧栏和底栏宽度/高度归零
  const leftValidCount = countValidModules(slotConfig.left.modules);
  const rightValidCount = countValidModules(slotConfig.right.modules);
  const lw = isImmersive || leftPanelCollapsed || leftValidCount === 0
    ? 0
    : (leftSlotCollapsed ? 56 : leftPanelWidth);
  const rw = isImmersive || rightPanelCollapsed || rightValidCount === 0
    ? 0
    : (rightSlotCollapsed ? 56 : rightPanelWidth);
  const th = isImmersive ? 0 : (topPanelCollapsed ? 0 : topPanelHeight);
  const bh = isImmersive ? 0 : effectiveBottomRowHeight;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // 应用关闭时清空所有会话
  useEffect(() => {
    const handleBeforeUnload = () => {
      getAllConnectors().forEach(c => c.close());
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [getAllConnectors]);

  // 清理旧版本遗留的持久化数据（tabs/sessions 不再持久化）
  useEffect(() => {
    localStorage.removeItem("lazy-term-sessions");
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(media.matches);
    media.addEventListener("change", handleChange);

    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    // 移除之前的强制覆盖
    root.style.removeProperty("--color-background");
    root.style.removeProperty("--background");

    const isDark = appBackgroundColor === "dark" || (appBackgroundColor === "system" && systemPrefersDark);

    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // 当启用背景图片时，禁用 body 的默认背景渐变
    if (hasBackgroundImage) {
      body.classList.add("has-background-image");
    } else {
      body.classList.remove("has-background-image");
    }
  }, [appBackgroundColor, hasBackgroundImage, systemPrefersDark]);

  // 同步外观自定义到 CSS 变量
  useEffect(() => {
    const root = document.documentElement;
    const mediumFontWeight = Math.round((normalFontWeight + boldFontWeight) / 2);
    root.style.setProperty("--app-font-weight-normal", `${normalFontWeight}`);
    root.style.setProperty("--app-font-weight-medium", `${mediumFontWeight}`);
    root.style.setProperty("--app-font-weight-bold", `${boldFontWeight}`);
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
  }, [uiOpacity, shouldDisableUiBlur, normalFontWeight, boldFontWeight]);

  return (
    <div className="app-frame relative h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* 正常/专注模式：固定标题栏；沉浸模式：隐藏 */}
      {!isImmersive && <CustomTitleBar />}
      {/* 沉浸模式：悬浮标题栏 */}
      {isImmersive && <ImmersiveHoverBar />}
      <div
        id="lazy-term-root"
        className="app-shell relative min-h-0 flex-1 overflow-hidden bg-background text-foreground"
        style={{
          display: "grid",
          gridTemplateAreas: `
            "left mid-top    right"
            "left mid-main   right"
            "left mid-bottom right"
          `,
          gridTemplateColumns: `${lw}px 1fr ${rw}px`,
          gridTemplateRows: `${th}px 1fr ${bh}px`,
        }}
      >
        {/* 背景装饰球 — 沉浸模式下隐藏 */}
        {!isImmersive && (
          <>
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
          </>
        )}

        {/* 背景图片层 - 使用负 z-index 确保在所有内容后面 */}
        {hasBackgroundImage && (
          <div
            className="fixed inset-0 pointer-events-none"
            style={{
              zIndex: -1,
              backgroundImage: backgroundImage ? `url("${backgroundImage}")` : "none",
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
              opacity: backgroundOpacity / 100,
              filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : undefined,
            }}
          />
        )}

        {/* 内容层 — 确保在背景之上 */}
        {/* 沉浸模式下隐藏所有插槽；专注模式下仅保留顶部标签栏 */}
        {!isImmersive && <SlotManager />}
        <section
          id="slot-mid-main"
          className="relative z-0 min-h-0 min-w-0 overflow-hidden"
          style={{
            gridArea: "mid-main",
          }}
        >
          <PaneContainer />
        </section>

        <AlertDialog open={!!connectionError} onOpenChange={(open) => !open && clearConnectionError()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {connectionError?.sessionType === "ssh"
                  ? t("SSH 连接失败")
                  : connectionError?.sessionType === "rdp"
                    ? t("远程桌面连接失败")
                    : connectionError?.sessionType === "vnc"
                      ? t("VNC 连接失败")
                      : t("终端连接失败")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {connectionError
                  ? t("{target} 未能建立连接。{summary}", {
                      target: connectionError.sessionTarget || t("会话“{title}”", { title: connectionError.sessionTitle }),
                      summary: localizedConnectionError?.summary ?? connectionError.summary,
                    })
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {connectionError ? (
              <div className="space-y-3 text-sm">
                <div className="rounded-2xl border border-border/60 bg-background/45 px-4 py-3 text-muted-foreground">
                  <div className="font-medium text-foreground">{t("建议排查")}</div>
                  <ul className="mt-2 space-y-1.5 pl-5">
                    {(localizedConnectionError?.guidance ?? connectionError.guidance).map((item) => (
                      <li key={item} className="list-disc">{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-2xl border border-border/60 bg-black/25 px-4 py-3 text-xs leading-6 text-muted-foreground">
                  <div className="font-medium text-foreground">{t("技术详情")}</div>
                  <div className="mt-1 break-all">{connectionError.technicalDetails}</div>
                </div>
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogAction onClick={clearConnectionError}>{t("知道了")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 全局设置弹窗 */}
        <SettingsDialog />

        {/* 全局 Toast 通知 */}
        <ToastContainer />
      </div>
    </div>
  );
}

export default App;
