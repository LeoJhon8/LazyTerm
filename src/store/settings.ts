import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  // 外观设置
  theme: "light" | "dark" | "system";
  fontSize: number;
  fontFamily: string;
  
  // 布局设置
  leftPanelWidth: number;
  rightPanelWidth: number;
  topPanelHeight: number;
  bottomPanelHeight: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  topPanelCollapsed: boolean;
  bottomPanelCollapsed: boolean;

  // 终端设置
  cursorBlink: boolean;
  scrollback: number;
  tabStopWidth: number;

  // 方法
  setTheme: (theme: "light" | "dark" | "system") => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  updateLayout: (layout: Partial<Omit<SettingsState, 
    'theme' | 'fontSize' | 'fontFamily' | 'cursorBlink' | 'scrollback' | 'tabStopWidth' | 
    'setTheme' | 'setFontSize' | 'setFontFamily' | 'updateLayout' | 'resetSettings'>>) => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: "dark" as const,
  fontSize: 14,
  fontFamily: "monospace",
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
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setTheme: (theme) => set({ theme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      
      updateLayout: (layout) => set((state) => ({ ...state, ...layout })),

      resetSettings: () => set(defaultSettings),
    }),
    {
      name: "lazy-terminal-settings",
    }
  )
);