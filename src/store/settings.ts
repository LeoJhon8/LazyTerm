import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TerminalColorScheme } from "@/config/themes";
import { TERMINAL_THEMES } from "@/config/themes";

export type BackgroundImageUiMode = "frosted" | "clear";

interface SettingsData {
  fontSize: number;
  fontFamily: string;
  leftPanelWidth: number;
  rightPanelWidth: number;
  topPanelHeight: number;
  bottomPanelHeight: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  topPanelCollapsed: boolean;
  bottomPanelCollapsed: boolean;
  cursorBlink: boolean;
  scrollback: number;
  tabStopWidth: number;
  defaultShell: string;
  confirmCloseNonDefaultTabs: boolean;
  terminalAutocomplete: boolean;
  // 外观自定义
  appBackgroundColor: "system" | "light" | "dark"; // 全局背景色 (终端外)
  terminalColorScheme: string;        // 终端配色方案名称
  customThemeColors: TerminalColorScheme; // 自定义终端配色数据
  terminalOpacity: number;            // 终端背景透明度 0~100
  backgroundImageEnabled: boolean;    // 是否开启图片背景
  backgroundImagePath: string;        // 背景图片的真实路径(用于展示)
  backgroundImage: string;            // 背景图片路径/URL(用于渲染)
  backgroundImageUiMode: BackgroundImageUiMode; // 图片背景下 UI 呈现方式
  backgroundBlur: number;             // 背景模糊度 0~20 (px)
  backgroundOpacity: number;          // 背景图片不透明度 0~100
  uiOpacity: number;                  // UI 面板不透明度 30~100
}

interface SettingsActions {
  setSettings: (settings: Partial<SettingsData>) => void;
  resetSettings: () => void;
}

export type SettingsState = SettingsData & SettingsActions;

const defaultSettings: SettingsData = {
  fontSize: 14,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  leftPanelWidth: 200,
  rightPanelWidth: 200,
  topPanelHeight: 40,
  bottomPanelHeight: 40,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  topPanelCollapsed: false,
  bottomPanelCollapsed: false,
  cursorBlink: true,
  scrollback: 10000,
  tabStopWidth: 4,
  defaultShell: "powershell.exe",
  confirmCloseNonDefaultTabs: false,
  terminalAutocomplete: true,
  // 外观自定义默认值
  appBackgroundColor: "system",
  terminalColorScheme: "system-auto",
  customThemeColors: {
    ...TERMINAL_THEMES[0],
    name: "custom",
    label: "自定义",
  },
  terminalOpacity: 100,
  backgroundImageEnabled: false,
  backgroundImagePath: "",
  backgroundImage: "",
  backgroundImageUiMode: "frosted",
  backgroundBlur: 0,
  backgroundOpacity: 100,
  uiOpacity: 100,
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
      // 只持久化数据，不持久化方法
      partialize: (state) => {
        const data: Partial<SettingsState> = { ...state };
        delete data.setSettings;
        delete data.resetSettings;
        return data;
      },
    }
  )
);