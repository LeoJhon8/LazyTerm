import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invalidateCache, migrateToGitDir } from "@/store/git-aware-storage";
import { logger } from "@/lib/logger";

interface GitSyncData {
  gitRepoPath: string;
  lastSyncTime: number | null;
}

interface GitSyncActions {
  setGitRepoPath: (path: string) => void;
  setLastSyncTime: (time: number) => void;
  resetGitSync: () => void;
}

export type GitSyncState = GitSyncData & GitSyncActions;

const defaultState: GitSyncData = {
  gitRepoPath: "",
  lastSyncTime: null,
};

export const useGitSyncStore = create<GitSyncState>()(
  persist(
    (set) => ({
      ...defaultState,
      setGitRepoPath: (path) => {
        set({ gitRepoPath: path });
        // gitRepoPath 变更时：清除缓存 + 迁移数据到新目录
        invalidateCache();
        if (path) {
          migrateToGitDir().catch((error) => {
            logger.error("GitSyncStore", "迁移配置到 git 目录失败", { error });
          });
        }
      },
      setLastSyncTime: (time) => set({ lastSyncTime: time }),
      resetGitSync: () => set(defaultState),
    }),
    {
      name: "lazy-term-git-sync",
      partialize: (state) => ({
        gitRepoPath: state.gitRepoPath,
        lastSyncTime: state.lastSyncTime,
      }),
    }
  )
);
