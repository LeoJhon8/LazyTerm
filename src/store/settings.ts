import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  DEFAULT_TERMINAL_BACKGROUND_COLOR,
  type TerminalBackgroundMode,
  type TerminalColorScheme,
} from "@/config/themes";
import { DEFAULT_LANGUAGE_SETTING, type AppLanguageSetting } from "@/i18n/config";
import type { ConfigurableRdpBackend } from "@/lib/rdp-backend";
import { gitAwareStorage } from "@/store/git-aware-storage";
import { DEFAULT_QUICK_COMMAND_FONT_SIZE, normalizeQuickCommandFontSize } from "@/store/settings-values";

export type BackgroundImageUiMode = "frosted" | "clear";
export type QuickCommandDisplayMode = "bar" | "panel";
export type TerminalCursorStyle = "block" | "underline" | "bar";
export type TerminalRightClickBehavior = "context-menu" | "quick-copy-paste";
export type AppBackgroundColor = "system" | "light" | "dark" | "custom";

export interface AppColorPalette {
  color: string;
  background?: string;
  primary?: string;
}

/**
 * 视图模式
 * - normal: 标准布局，所有面板正常显示
 * - focus: 专注模式，仅隐藏左右侧边栏和底栏，保留标题栏和标签栏
 * - immersive: 沉浸模式，隐藏一切 UI，终端全屏
 */
export type ViewMode = "normal" | "focus" | "immersive";

interface SettingsData {
  language: AppLanguageSetting;
  fontSize: number;
  fontFamily: string;
  normalFontWeight: number;
  boldFontWeight: number;
  terminalNormalFontWeight: number;
  terminalBoldFontWeight: number;
  leftPanelWidth: number;
  rightPanelWidth: number;
  topPanelHeight: number;
  bottomPanelHeight: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  topPanelCollapsed: boolean;
  bottomPanelCollapsed: boolean;
  cursorBlink: boolean;
  terminalCursorStyle: TerminalCursorStyle;
  scrollback: number;
  tabStopWidth: number;
  defaultShell: string;
  confirmCloseNonDefaultTabs: boolean;
  rdpBackend: ConfigurableRdpBackend;
  terminalAutocomplete: boolean;
  autocompleteSource: ('history' | 'quick')[];  // 自动补全数据源（多选）
  terminalTimelineEnabled: boolean;
  copyOnSelect: boolean;
  terminalRightClickBehavior: TerminalRightClickBehavior;
  // 外观自定义
  appBackgroundColor: AppBackgroundColor; // 全局背景色 (终端外)
  appColorPalette: AppColorPalette;
  terminalColorScheme: string;                  // 终端配色方案名称（预设名或 custom-xxx）
  customThemes: TerminalColorScheme[];          // 用户自定义终端配色方案列表
  terminalBackgroundMode: TerminalBackgroundMode; // 终端区域底色模式
  terminalBackgroundColor: string;              // 自定义终端区域底色
  terminalOpacity: number;            // 终端背景透明度 0~100
  backgroundImageEnabled: boolean;    // 是否开启图片背景
  backgroundImagePath: string;        // 背景图片的真实路径(用于展示)
  backgroundImage: string;            // 背景图片路径/URL(用于渲染)
  backgroundImageUiMode: BackgroundImageUiMode; // 图片背景下 UI 呈现方式
  backgroundBlur: number;             // 背景模糊度 0~20 (px)
  backgroundOpacity: number;          // 背景图片不透明度 0~100
  uiOpacity: number;                  // UI 面板不透明度 30~100
  // 视图模式
  viewMode: ViewMode;                  // 当前视图模式（不持久化）
  immersiveHoverBarDelay: number;      // 悬浮标题栏消失延迟 (ms)
  immersiveShowTabStrip: boolean;      // 沉浸模式下是否显示悬浮标签条
  quickCommandDisplayMode: QuickCommandDisplayMode; // 快捷命令显示方式
  quickCommandFontSize: number;
}

interface SettingsActions {
  setSettings: (settings: Partial<SettingsData>) => void;
  resetSettings: () => void;
}

export type SettingsState = SettingsData & SettingsActions;

const LEGACY_DEFAULT_FONT_FAMILY = "Menlo, Monaco, 'Courier New', monospace";
const DEFAULT_FONT_FAMILY = "'Geist Mono', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace";

export const DEFAULT_APP_COLOR_PALETTE: AppColorPalette = {
  color: "#101820",
};

const defaultSettings: SettingsData = {
  language: DEFAULT_LANGUAGE_SETTING,
  fontSize: 14,
  fontFamily: DEFAULT_FONT_FAMILY,
  normalFontWeight: 400,
  boldFontWeight: 550,
  terminalNormalFontWeight: 400,
  terminalBoldFontWeight: 700,
  leftPanelWidth: 220,
  rightPanelWidth: 220,
  topPanelHeight: 40,
  bottomPanelHeight: 40,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  topPanelCollapsed: false,
  bottomPanelCollapsed: false,
  cursorBlink: true,
  terminalCursorStyle: "bar",
  scrollback: 10000,
  tabStopWidth: 4,
  defaultShell: "powershell.exe",
  confirmCloseNonDefaultTabs: false,
  rdpBackend: "freerdp",
  terminalAutocomplete: false,
  autocompleteSource: [],  // 默认不启用任何自动补全数据源
  terminalTimelineEnabled: false,
  copyOnSelect: false,
  terminalRightClickBehavior: "context-menu",
  // 外观自定义默认值
  appBackgroundColor: "system",
  appColorPalette: DEFAULT_APP_COLOR_PALETTE,
  terminalColorScheme: "system-auto",
  customThemes: [],
  terminalBackgroundMode: "auto",
  terminalBackgroundColor: DEFAULT_TERMINAL_BACKGROUND_COLOR,
  terminalOpacity: 100,
  backgroundImageEnabled: false,
  backgroundImagePath: "",
  backgroundImage: "",
  backgroundImageUiMode: "frosted",
  backgroundBlur: 0,
  backgroundOpacity: 100,
  uiOpacity: 100,
  viewMode: "normal",
  immersiveHoverBarDelay: 800,
  immersiveShowTabStrip: true,
  quickCommandDisplayMode: "bar",
  quickCommandFontSize: DEFAULT_QUICK_COMMAND_FONT_SIZE,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,
      setSettings: (newSettings) => set((state) => ({
        ...state,
        ...newSettings,
        ...(newSettings.quickCommandFontSize !== undefined
          ? { quickCommandFontSize: normalizeQuickCommandFontSize(newSettings.quickCommandFontSize) }
          : {}),
      })),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: "lazy-term-settings",
      storage: createJSONStorage(() => gitAwareStorage),
      version: 3,
      migrate: (persistedState, version) => {
        if (persistedState && typeof persistedState === "object") {
          const data: Partial<SettingsData> = { ...(persistedState as Partial<SettingsData>) };

          if (version < 1 && data.fontFamily === LEGACY_DEFAULT_FONT_FAMILY) {
            data.fontFamily = DEFAULT_FONT_FAMILY;
          }

          if (version < 2) {
            const selectedCustomTheme = data.customThemes?.find(
              (theme) => theme.name === data.terminalColorScheme
            );
            const legacyBackground = selectedCustomTheme?.background;
            const hasCustomBackground = !!legacyBackground && /^#[\da-f]{6}$/i.test(legacyBackground);

            data.terminalBackgroundMode = hasCustomBackground ? "custom" : "auto";
            data.terminalBackgroundColor = hasCustomBackground
              ? legacyBackground
              : DEFAULT_TERMINAL_BACKGROUND_COLOR;
          }

          if (version < 3) {
            data.copyOnSelect = true;
            data.terminalRightClickBehavior = "quick-copy-paste";
          }

          return data;
        }

        return persistedState;
      },
      // 只持久化数据，不持久化方法
      partialize: (state) => {
        const data: Partial<SettingsState> = { ...state };
        delete data.setSettings;
        delete data.resetSettings;
        // 视图模式不持久化，每次启动默认 normal
        delete data.viewMode;
        return data;
      },
    }
  )
);
