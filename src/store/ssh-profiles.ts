import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SSHConfig } from "@/types/terminal";

/**
 * SSH 配置模板
 */
export interface SSHProfile {
  id: string;
  config: SSHConfig;
  order: number;
}

interface SSHProfilesState {
  profiles: SSHProfile[];
  addProfile: (cfg: SSHConfig) => void;
  updateProfile: (id: string, cfg: SSHConfig) => void;
  removeProfile: (id: string) => void;
  reorderProfiles: (newOrder: string[]) => void;
}

export const useSshProfilesStore = create<SSHProfilesState>()(
  persist(
    (set, get) => ({
      profiles: [],

      addProfile: (cfg) => {
        const id = Math.random().toString(36).substring(2, 11);
        set((state) => {
          const nextOrder = state.profiles.length > 0 ? Math.max(...state.profiles.map(p => p.order)) + 1 : 0;
          return {
            profiles: [...state.profiles, { id, config: cfg, order: nextOrder }],
          };
        });
      },

      updateProfile: (id, cfg) => {
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === id ? { ...p, config: cfg } : p
          ),
        }));
      },

      removeProfile: (id) => {
        set((state) => ({
          profiles: state.profiles.filter((p) => p.id !== id),
        }));
      },

      reorderProfiles: (newOrder) => {
        set((state) => {
          const idToProfile: Record<string, SSHProfile> = {};
          state.profiles.forEach((p) => {
            idToProfile[p.id] = p;
          });
          const reordered: SSHProfile[] = [];
          newOrder.forEach((id, idx) => {
            const prof = idToProfile[id];
            if (prof) {
              reordered.push({ ...prof, order: idx });
            }
          });
          return { profiles: reordered };
        });
      },
    }),
    {
      name: "lazy-terminal-ssh-profiles",
      storage: createJSONStorage(() => localStorage),
    }
  )
);