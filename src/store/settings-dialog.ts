import { create } from "zustand";

/** 设置弹窗可打开的 Tab 页 */
export type SettingsTab = "general" | "appearance" | "layout" | "ai" | "credentials" | "data" | "about";

interface SettingsDialogData {
  /** 弹窗是否打开 */
  open: boolean;
  /** 打开时默认激活的 Tab */
  activeTab: SettingsTab;
}

interface SettingsDialogActions {
  /** 打开设置弹窗，可指定默认 Tab */
  openSettings: (tab?: SettingsTab) => void;
  /** 关闭设置弹窗 */
  closeSettings: () => void;
  /** 设置当前激活 Tab */
  setActiveTab: (tab: SettingsTab) => void;
}

export type SettingsDialogState = SettingsDialogData & SettingsDialogActions;

export const useSettingsDialogStore = create<SettingsDialogState>()((set) => ({
  open: false,
  activeTab: "general",

  openSettings: (tab) =>
    set({ open: true, activeTab: tab ?? "general" }),

  closeSettings: () =>
    set({ open: false }),

  setActiveTab: (tab) =>
    set({ activeTab: tab }),
}));
