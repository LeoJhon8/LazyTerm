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