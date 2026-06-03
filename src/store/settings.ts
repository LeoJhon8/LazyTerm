import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { TerminalColorScheme } from "@/config/themes";
import { DEFAULT_LANGUAGE_SETTING, type AppLanguageSetting } from "@/i18n/config";
import type { ConfigurableRdpBackend } from "@/lib/rdp-backend";
import { gitAwareStorage } from "@/store/git-aware-storage";

export type BackgroundImageUiMode = "frosted" | "clear";
export type QuickCommandDisplayMode = "bar" | "panel";
export type TerminalCursorStyle = "block" | "underline" | "bar";

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
  // 外观自定义
  appBackgroundColor: "system" | "light" | "dark"; // 全局背景色 (终端外)
  terminalColorScheme: string;                  // 终端配色方案名称（预设名或 custom-xxx）
  customThemes: TerminalColorScheme[];          // 用户自定义终端配色方案列表
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
}

interface SettingsActions {
  setSettings: (settings: Partial<SettingsData>) => void;
  resetSettings: () => void;
}

export type SettingsState = SettingsData & SettingsActions;

const LEGACY_DEFAULT_FONT_FAMILY = "Menlo, Monaco, 'Courier New', monospace";
const DEFAULT_FONT_FAMILY = "'Geist Mono', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace";

const defaultSettings: SettingsData = {
  language: DEFAULT_LANGUAGE_SETTING,
  fontSize: 14,
  fontFamily: DEFAULT_FONT_FAMILY,
  normalFontWeight: 400,
  boldFontWeight: 550,
  terminalNormalFontWeight: 400,
  terminalBoldFontWeight: 700,
  leftPanelWidth: 200,
  rightPanelWidth: 200,
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
  terminalAutocomplete: true,
  autocompleteSource: ['history', 'quick'],  // 默认从所有数据源进行自动补全
  // 外观自定义默认值
  appBackgroundColor: "system",
  terminalColorScheme: "system-auto",
  customThemes: [],
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
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,
      setSettings: (newSettings) => set((state) => ({ ...state, ...newSettings })),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: "lazy-term-settings",
      storage: createJSONStorage(() => gitAwareStorage),
      version: 1,
      migrate: (persistedState, version) => {
        if (version < 1 && persistedState && typeof persistedState === "object") {
          const data = persistedState as Partial<SettingsData>;
          if (data.fontFamily === LEGACY_DEFAULT_FONT_FAMILY) {
            return {
              ...data,
              fontFamily: DEFAULT_FONT_FAMILY,
            };
          }
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
