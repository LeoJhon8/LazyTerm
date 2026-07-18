import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SlotConfig } from "../config/default-slot-config";
import { DEFAULT_SLOT_CONFIG, VALID_SLOT_MODULE_IDS } from "../config/default-slot-config";
import { gitAwareStorage } from "@/store/git-aware-storage";

/** 清理持久化数据中的无效 moduleId，并修正关联状态 */
function sanitizeSlotConfig(config: SlotConfig): SlotConfig {
  for (const side of ["left", "right"] as const) {
    const validModules = config[side].modules.filter(id => VALID_SLOT_MODULE_IDS.has(id));
    const modulesChanged = validModules.length !== config[side].modules.length;

    if (modulesChanged) {
      config[side].modules = validModules;
      // 修正 activeModule：如果被移除则指向第一个有效模块
      if (!VALID_SLOT_MODULE_IDS.has(config[side].activeModule)) {
        config[side].activeModule = validModules[0] || "";
      }
      // 无有效模块时自动收起
      if (validModules.length === 0) {
        config[side].collapsed = true;
      }
    }
  }
  config.top = { ...DEFAULT_SLOT_CONFIG.top };
  config.bottom = { ...DEFAULT_SLOT_CONFIG.bottom };
  return config;
}

interface SlotConfigState {
  // 当前配置
  currentConfig: SlotConfig;
  
  // 配置操作方法
  updateSlotConfig: (config: Partial<SlotConfig>) => void;
  setActiveModule: (slot: 'left' | 'right', moduleId: string) => void;
  toggleSlotCollapse: (slot: 'left' | 'right') => void;
  setSlotCollapsed: (slot: 'left' | 'right', collapsed: boolean) => void;
  setActiveAndExpand: (slot: 'left' | 'right', moduleId: string) => void;
  addModuleToSlot: (slot: 'left' | 'right', moduleId: string) => void;
  removeModuleFromSlot: (slot: 'left' | 'right', moduleId: string) => void;
  resetToDefault: () => void;
  saveCustomConfig: (name: string) => void;
  loadConfig: (config: SlotConfig) => void;
}

export const useSlotConfigStore = create<SlotConfigState>()(
  persist(
    (set, get) => ({
      currentConfig: DEFAULT_SLOT_CONFIG,

      updateSlotConfig: (config) => 
        set((state) => ({ 
          currentConfig: { ...state.currentConfig, ...config } 
        })),

      setActiveModule: (slot, moduleId) =>
        set((state) => ({
          currentConfig: {
            ...state.currentConfig,
            [slot]: {
              ...state.currentConfig[slot],
              activeModule: moduleId
            }
          }
        })),
      
      toggleSlotCollapse: (slot) =>
        set((state) => {
          // 无模块时禁止展开
          if (state.currentConfig[slot].modules.length === 0) {
            return state;
          }
          return {
            currentConfig: {
              ...state.currentConfig,
              [slot]: {
                ...state.currentConfig[slot],
                collapsed: !state.currentConfig[slot].collapsed
              }
            }
          };
        }),

      setSlotCollapsed: (slot, collapsed) =>
        set((state) => ({
          currentConfig: {
            ...state.currentConfig,
            [slot]: {
              ...state.currentConfig[slot],
              collapsed
            }
          }
        })),

      setActiveAndExpand: (slot, moduleId) =>
        set((state) => ({
          currentConfig: {
            ...state.currentConfig,
            [slot]: {
              ...state.currentConfig[slot],
              activeModule: moduleId,
              collapsed: false
            }
          }
        })),

      addModuleToSlot: (slot, moduleId) =>
        set((state) => {
          const currentModules = [...state.currentConfig[slot].modules];
          if (!currentModules.includes(moduleId)) {
            currentModules.push(moduleId);
          }
          return {
            currentConfig: {
              ...state.currentConfig,
              [slot]: {
                ...state.currentConfig[slot],
                modules: currentModules
              }
            }
          };
        }),

      removeModuleFromSlot: (slot, moduleId) =>
        set((state) => {
          const currentModules = state.currentConfig[slot].modules.filter(id => id !== moduleId);
          const activeModule = state.currentConfig[slot].activeModule === moduleId 
            ? currentModules[0] || ''
            : state.currentConfig[slot].activeModule;
          
          return {
            currentConfig: {
              ...state.currentConfig,
              [slot]: {
                ...state.currentConfig[slot],
                modules: currentModules,
                activeModule,
                collapsed: currentModules.length === 0 ? true : state.currentConfig[slot].collapsed
              }
            }
          };
        }),

      resetToDefault: () => 
        set({ currentConfig: DEFAULT_SLOT_CONFIG }),

      saveCustomConfig: (name) => {
        // 这里可以扩展为保存多个配置文件
        const config = get().currentConfig;
        localStorage.setItem(`lazy-term-slot-config-${name}`, JSON.stringify(config));
      },

      loadConfig: (config) =>
        set({ currentConfig: sanitizeSlotConfig({ ...config }) })
    }),
    {
      name: "lazy-term-slot-config",
      storage: createJSONStorage(() => gitAwareStorage),
      partialize: (state) => ({ currentConfig: state.currentConfig }),
      // hydrate 时清理无效 moduleId（如已删除的 SettingsModule）
      merge: (persisted, current) => {
        const persistedState = persisted as { currentConfig?: SlotConfig };
        if (persistedState?.currentConfig) {
          const sanitized = sanitizeSlotConfig({ ...persistedState.currentConfig });
          return { ...current, currentConfig: sanitized };
        }
        return current;
      },
    }
  )
);
