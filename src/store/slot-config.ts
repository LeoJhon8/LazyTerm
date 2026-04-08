import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SlotConfig } from "../config/default-slot-config";
import { DEFAULT_SLOT_CONFIG } from "../config/default-slot-config";

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
  setSingleModule: (slot: 'top' | 'bottom', moduleId: string) => void;
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
        set((state) => ({
          currentConfig: {
            ...state.currentConfig,
            [slot]: {
              ...state.currentConfig[slot],
              collapsed: !state.currentConfig[slot].collapsed
            }
          }
        })),

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

      setSingleModule: (slot, moduleId) =>
        set((state) => ({
          currentConfig: {
            ...state.currentConfig,
            [slot]: {
              module: moduleId
            }
          }
        })),

      resetToDefault: () => 
        set({ currentConfig: DEFAULT_SLOT_CONFIG }),

      saveCustomConfig: (name) => {
        // 这里可以扩展为保存多个配置文件
        const config = get().currentConfig;
        localStorage.setItem(`lazy-term-slot-config-${name}`, JSON.stringify(config));
      },

      loadConfig: (config) => 
        set({ currentConfig: config })
    }),
    {
      name: "lazy-term-slot-config",
      partialize: (state) => ({ currentConfig: state.currentConfig })
    }
  )
);