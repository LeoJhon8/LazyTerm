import { useEffect, useState } from "react";
import { DEFAULT_APP_COLOR_PALETTE, useSettingsStore } from "@/store/settings";
import { useSlotConfigStore } from "@/store/slot-config";
import { useTabsStore } from "@/store/tabs";
import { getConnectionErrorPresentation } from "@/services/connectionErrorService";
import { useI18n } from "@/i18n";
import { useUpdateNotification } from "@/hooks/useUpdateNotification";
import { useViewMode } from "@/hooks/useViewMode";
import { countValidModules, getValidActivityModules } from "@/components/layout/activity-registry";
import { AI_MODULE_ID, isAiConfigured, useAiConfigStore } from "@/store/ai";

import { PaneContainer } from "@/components/layout/PaneContainer";
import { SlotManager } from "@/components/layout/SlotManager";
import { CustomTitleBar } from "@/components/layout/CustomTitleBar";
import { ImmersiveHoverBar } from "@/components/layout/ImmersiveHoverBar";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { CredentialVaultUnlockDialog } from "@/components/dialogs/CredentialVaultUnlockDialog";
import { SessionEntryDialogs } from "@/components/layout/SessionEntryDialogs";
import { useCredentialsStore } from "@/store/credentials";
import { migrateProfileCredentials } from "@/services/credentialProfileMigration";
import { ToastContainer } from "@/components/ui/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { AppColorPalette } from "@/store/settings";

const CUSTOM_PALETTE_VARIABLES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--border",
  "--input",
  "--ring",
  "--panel",
  "--panel-strong",
  "--panel-border",
  "--panel-glow",
  "--panel-shadow",
  "--app-gradient-a",
  "--app-gradient-b",
  "--app-gradient-c",
  "--titlebar-surface",
  "--titlebar-surface-hover",
  "--terminal-shell",
  "--terminal-border",
  "--app-shell-frame-opacity",
] as const;

function getHexLuminance(color: string): number {
  const normalized = color.replace("#", "").trim();
  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return 1;
  }

  const channels = [0, 2, 4].map((start) => {
    const value = parseInt(normalized.slice(start, start + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function getReadableForeground(background: string): string {
  return getHexLuminance(background) > 0.42 ? "#111827" : "#ffffff";
}

function getAppCustomColor(palette: AppColorPalette): string {
  return palette.color ?? palette.background ?? palette.primary ?? DEFAULT_APP_COLOR_PALETTE.color;
}

function applyCustomPalette(root: HTMLElement, palette: AppColorPalette) {
  const color = getAppCustomColor(palette);
  const isDark = getHexLuminance(color) <= 0.42;
  const contrastColor = isDark ? "white" : "black";
  const softContrastColor = isDark ? "white" : color;
  const primary = isDark
    ? `color-mix(in srgb, ${color} 50%, white 50%)`
    : `color-mix(in srgb, ${color} 68%, black 32%)`;
  const accent = isDark
    ? `color-mix(in srgb, ${color} 76%, white 24%)`
    : `color-mix(in srgb, ${color} 88%, black 12%)`;
  const panel = isDark
    ? `color-mix(in srgb, ${color} 88%, white 12%)`
    : `color-mix(in srgb, ${color} 94%, white 6%)`;
  const border = isDark
    ? `color-mix(in srgb, ${color} 82%, white 18%)`
    : `color-mix(in srgb, ${color} 88%, black 12%)`;
  const foreground = getReadableForeground(color);
  const primaryForeground = isDark ? "#111827" : "#ffffff";
  const accentForeground = isDark ? "#ffffff" : "#111827";

  root.style.setProperty("--background", color);
  root.style.setProperty("--foreground", foreground);
  root.style.setProperty("--card", `color-mix(in srgb, ${panel} 92%, ${color} 8%)`);
  root.style.setProperty("--card-foreground", foreground);
  root.style.setProperty("--popover", `color-mix(in srgb, ${panel} 96%, transparent)`);
  root.style.setProperty("--popover-foreground", foreground);
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--primary-foreground", primaryForeground);
  root.style.setProperty("--secondary", `color-mix(in srgb, ${panel} 72%, ${color} 28%)`);
  root.style.setProperty("--secondary-foreground", foreground);
  root.style.setProperty("--muted", `color-mix(in srgb, ${panel} 70%, ${color} 30%)`);
  root.style.setProperty("--muted-foreground", `color-mix(in srgb, ${foreground} 68%, ${color} 32%)`);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-foreground", accentForeground);
  root.style.setProperty("--border", `color-mix(in srgb, ${border} 42%, transparent)`);
  root.style.setProperty("--input", `color-mix(in srgb, ${border} 34%, transparent)`);
  root.style.setProperty("--ring", `color-mix(in srgb, ${primary} 42%, transparent)`);
  root.style.setProperty("--panel", `color-mix(in srgb, ${panel} 84%, transparent)`);
  root.style.setProperty("--panel-strong", `color-mix(in srgb, ${panel} 94%, transparent)`);
  root.style.setProperty("--panel-border", `color-mix(in srgb, ${border} 38%, transparent)`);
  root.style.setProperty("--panel-glow", "none");
  root.style.setProperty(
    "--panel-shadow",
    isDark
      ? "0 20px 48px rgba(0, 0, 0, 0.22)"
      : "0 14px 36px rgba(0, 0, 0, 0.045)"
  );
  root.style.setProperty("--app-gradient-a", `color-mix(in srgb, ${softContrastColor} 14%, transparent)`);
  root.style.setProperty("--app-gradient-b", `color-mix(in srgb, ${contrastColor} 10%, transparent)`);
  root.style.setProperty("--app-gradient-c", `color-mix(in srgb, ${softContrastColor} 8%, transparent)`);
  root.style.setProperty("--titlebar-surface", `color-mix(in srgb, ${panel} 92%, ${color} 8%)`);
  root.style.setProperty("--titlebar-surface-hover", `color-mix(in srgb, ${accent} 52%, ${panel} 48%)`);
  root.style.setProperty("--terminal-shell", `color-mix(in srgb, ${color} 70%, transparent)`);
  root.style.setProperty("--terminal-border", `color-mix(in srgb, ${border} 52%, transparent)`);
  root.style.setProperty("--app-shell-frame-opacity", "0.28");
}

function App() {
  useUpdateNotification();
  const initializeCredentialVault = useCredentialsStore((state) => state.initialize);
  const credentialVaultStatus = useCredentialsStore((state) => state.status);

  const { locale, t } = useI18n();
  const { isImmersive, isFocus } = useViewMode();
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const {
    topPanelHeight,
    bottomPanelHeight,
    leftPanelWidth,
    rightPanelWidth,
    topPanelCollapsed,
    bottomPanelCollapsed,
    appBackgroundColor,
    appColorPalette,
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
  const resolvedAppColorPalette = appColorPalette ?? DEFAULT_APP_COLOR_PALETTE;

  const { currentConfig: slotConfig } = useSlotConfigStore();
  const aiConfigured = useAiConfigStore(isAiConfigured);
  const { getAllConnectors, connectionError, clearConnectionError, focusSessionId, sessions } = useTabsStore();
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
  const leftValidCount = countValidModules(slotConfig.left.modules, aiConfigured);
  const rightValidCount = countValidModules(slotConfig.right.modules, aiConfigured);
  const hideLeft = isImmersive || isFocus || leftValidCount === 0;
  const hideRight = isImmersive || isFocus || rightValidCount === 0;
  const getActivityPanelWidth = (side: "left" | "right") => {
    const slot = slotConfig[side];
    const hidden = side === "left" ? hideLeft : hideRight;
    const activeDefinition = getValidActivityModules([slot.activeModule], aiConfigured)[0];

    if (hidden || slot.collapsed || !activeDefinition) {
      return 0;
    }

    return side === "left" ? leftPanelWidth : rightPanelWidth;
  };
  const openLeftPanelWidth = getActivityPanelWidth("left");
  const openRightPanelWidth = getActivityPanelWidth("right");
  const localizedConnectionError = connectionError
    ? getConnectionErrorPresentation(connectionError.sessionType, connectionError.technicalDetails)
    : null;

  // 列宽/行高：直接同步计算（不再依赖异步 CSS 变量）
  // 沉浸模式下侧栏和底栏宽度/高度归零
  const lw = 0;
  const rw = 0;
  const th = isImmersive ? 0 : (topPanelCollapsed ? 0 : topPanelHeight);
  const bh = isImmersive ? 0 : effectiveBottomRowHeight;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (aiConfigured) return;
    const slotStore = useSlotConfigStore.getState();
    if (slotConfig.left.modules.includes(AI_MODULE_ID)) {
      slotStore.removeModuleFromSlot("left", AI_MODULE_ID);
    }
    if (slotConfig.right.modules.includes(AI_MODULE_ID)) {
      slotStore.removeModuleFromSlot("right", AI_MODULE_ID);
    }
  }, [aiConfigured, slotConfig.left.modules, slotConfig.right.modules]);

  useEffect(() => {
    void initializeCredentialVault();
  }, [initializeCredentialVault]);

  useEffect(() => {
    if (credentialVaultStatus === "unlocked") {
      void migrateProfileCredentials();
    }
  }, [credentialVaultStatus]);

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
    CUSTOM_PALETTE_VARIABLES.forEach((variable) => root.style.removeProperty(variable));

    const isCustom = appBackgroundColor === "custom";
    const isDark = isCustom
      ? getHexLuminance(getAppCustomColor(resolvedAppColorPalette)) <= 0.42
      : appBackgroundColor === "dark" || (appBackgroundColor === "system" && systemPrefersDark);

    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    if (isCustom) {
      applyCustomPalette(root, resolvedAppColorPalette);
    }

    // 当启用背景图片时，禁用 body 的默认背景渐变
    if (hasBackgroundImage) {
      body.classList.add("has-background-image");
    } else {
      body.classList.remove("has-background-image");
    }
  }, [appBackgroundColor, resolvedAppColorPalette, hasBackgroundImage, systemPrefersDark]);

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
          className="relative z-0 min-h-0 min-w-0 overflow-hidden transition-all duration-300"
          style={{
            gridArea: "mid-main",
            marginLeft: openLeftPanelWidth ? `${openLeftPanelWidth}px` : undefined,
            marginRight: openRightPanelWidth ? `${openRightPanelWidth}px` : undefined,
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
        <CredentialVaultUnlockDialog />
        <SessionEntryDialogs />

        {/* 全局 Toast 通知 */}
        <ToastContainer />
      </div>
    </div>
  );
}

export default App;
