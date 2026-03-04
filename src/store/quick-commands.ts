import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 快捷命令接口
 */
export interface QuickCommand {
  id: string;
  label: string;
  command: string;
  autoExecute: boolean; // 是否自动发送回车执行
  order: number;
}

interface QuickCommandsState {
  commands: QuickCommand[];
  addCommand: (command: Omit<QuickCommand, "id">) => void;
  removeCommand: (id: string) => void;
  updateCommand: (id: string, updates: Partial<QuickCommand>) => void;
  reorderCommands: (commandIds: string[]) => void;
}

const defaultCommands: QuickCommand[] = [
  { id: "1", label: "清屏", command: "clear", autoExecute: true, order: 0 },
  { id: "2", label: "列出文件", command: "ls -la", autoExecute: true, order: 1 },
  { id: "3", label: "当前路径", command: "pwd", autoExecute: true, order: 2 },
  { id: "4", label: "进程列表", command: "ps aux", autoExecute: true, order: 3 },
];

export const useQuickCommandsStore = create<QuickCommandsState>()(
  persist(
    (set) => ({
      commands: defaultCommands,

      addCommand: (command) => {
        const id = Math.random().toString(36).substring(2, 11);
        set((state) => ({
          commands: [
            ...state.commands,
            { ...command, id },
          ],
        }));
      },

      removeCommand: (id) => {
        set((state) => ({
          commands: state.commands.filter((cmd) => cmd.id !== id),
        }));
      },

      updateCommand: (id, updates) => {
        set((state) => ({
          commands: state.commands.map((cmd) =>
            cmd.id === id ? { ...cmd, ...updates } : cmd
          ),
        }));
      },

      reorderCommands: (commandIds: string[]) => {
        set((state) => ({
          commands: commandIds
            .map((id, index) => {
              const cmd = state.commands.find((c) => c.id === id);
              return cmd ? { ...cmd, order: index } : null;
            })
            .filter((cmd): cmd is QuickCommand => cmd !== null),
        }));
      },
    }),
    {
      name: "lazy-terminal-quick-commands",
    }
  )
);
