import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsData {
  theme: "light" | "dark" | "system";
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

  // 外观自定义
  accentColor: string;               // 主题强调色 (hex)
  terminalColorScheme: string;        // 终端配色方案名称
  terminalOpacity: number;            // 终端背景透明度 0~100
  backgroundImage: string;            // 背景图片路径/URL
  backgroundBlur: number;             // 背景模糊度 0~20 (px)
  backgroundOpacity: number;          // 背景图片不透明度 0~100
  uiOpacity: number;                  // UI 面板不透明度 30~100
  customCSS: string;                  // 自定义 CSS
}

interface SettingsActions {
  setSettings: (settings: Partial<SettingsData>) => void;
  resetSettings: () => void;
}

export type SettingsState = SettingsData & SettingsActions;

const defaultSettings: SettingsData = {
  theme: "dark",
  fontSize: 14,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  leftPanelWidth: 250,
  rightPanelWidth: 250,
  topPanelHeight: 40,
  bottomPanelHeight: 40,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  topPanelCollapsed: false,
  bottomPanelCollapsed: false,
  cursorBlink: true,
  scrollback: 10000,
  tabStopWidth: 4,

  // 外观自定义默认值
  accentColor: "",                    // 空字符串表示跟随系统主题
  terminalColorScheme: "system-auto",
  terminalOpacity: 100,
  backgroundImage: "",
  backgroundBlur: 0,
  backgroundOpacity: 100,
  uiOpacity: 100,
  customCSS: "",
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,
      setSettings: (newSettings) => set((state) => ({ ...state, ...newSettings })),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: "lazy-terminal-settings",
      // 只持久化数据，不持久化方法
      partialize: (state) => {
        const { setSettings, resetSettings, ...data } = state;
        return data;
      },
    }
  )
);