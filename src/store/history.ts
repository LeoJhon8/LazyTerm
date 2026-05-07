import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { gitAwareStorage } from "@/store/git-aware-storage";

/**
 * 历史命令接口
 */
export interface HistoryCommand {
  id: string;
  command: string;
  timestamp: number;
}

interface HistoryState {
  commands: HistoryCommand[];
  maxHistory: number; // 最大历史记录数，默认 30
  addCommand: (command: string) => void;
  clearCommands: () => void;
  removeCommand: (id: string) => void;
  getAllCommands: () => HistoryCommand[];
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      commands: [],
      maxHistory: 30,

      addCommand: (command: string) => {
        if (!command.trim()) return;

        set((state) => {
          // 检查是否已存在相同命令（去重）
          const exists = state.commands.some(
            (cmd) => cmd.command === command
          );

          if (exists) {
            // 如果已存在，移到最前面
            const filtered = state.commands.filter(
              (cmd) => cmd.command !== command
            );
            const newCommand: HistoryCommand = {
              id: Math.random().toString(36).substring(2, 11),
              command,
              timestamp: Date.now(),
            };
            // 限制记录数量
            const limited = [newCommand, ...filtered].slice(0, state.maxHistory);
            return { commands: limited };
          } else {
            // 新命令添加到开头
            const newCommand: HistoryCommand = {
              id: Math.random().toString(36).substring(2, 11),
              command,
              timestamp: Date.now(),
            };
            const limited = [newCommand, ...state.commands].slice(0, state.maxHistory);
            return { commands: limited };
          }
        });
      },

      clearCommands: () => {
        set({ commands: [] });
      },

      removeCommand: (id: string) => {
        set((state) => ({
          commands: state.commands.filter((cmd) => cmd.id !== id),
        }));
      },

      getAllCommands: () => {
        return get().commands;
      },
    }),
    {
      name: "lazy-term-history",
      storage: createJSONStorage(() => gitAwareStorage),
    }
  )
);
