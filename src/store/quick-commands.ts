import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { detectPreferredLocale, getSystemLanguage } from "@/i18n/config";
import { gitAwareStorage } from "@/store/git-aware-storage";

/**
 * 快捷命令接口
 */
export interface QuickCommand {
  id: string;
  label: string;
  command: string;
  order: number;
  createdAt: number;
}

interface QuickCommandsState {
  commands: QuickCommand[];
  addCommand: (command: Omit<QuickCommand, "id" | "order" | "createdAt">) => void;
  removeCommand: (id: string) => void;
  removeCommands: (ids: string[]) => void;
  updateCommand: (id: string, updates: Partial<QuickCommand>) => void;
  reorderCommands: (commandIds: string[]) => void;
}

const preferredLocale = detectPreferredLocale(getSystemLanguage());

export function normalizeQuickCommands(value: unknown): QuickCommand[] {
  if (!Array.isArray(value)) return [];

  const commands = value
    .filter((item): item is Record<string, unknown> => (
      typeof item === "object"
      && item !== null
      && typeof item.id === "string"
      && typeof item.label === "string"
      && typeof item.command === "string"
    ))
    .map((item, index) => ({
      id: item.id as string,
      label: item.label as string,
      command: item.command as string,
      order: typeof item.order === "number" && Number.isFinite(item.order)
        ? item.order
        : index,
      createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
        ? item.createdAt
        : undefined,
    }))
    .sort((a, b) => a.order - b.order);

  const existingCreatedAtValues = commands
    .map((item) => item.createdAt)
    .filter((createdAt): createdAt is number => createdAt !== undefined);
  const earliestCreatedAt = existingCreatedAtValues.length > 0
    ? Math.min(...existingCreatedAtValues)
    : Date.now();
  let legacyIndex = 0;
  const legacyCount = commands.length - existingCreatedAtValues.length;
  const legacyBase = earliestCreatedAt - legacyCount * 1000;

  return commands.map((item, index) => ({
    ...item,
    order: index,
    createdAt: item.createdAt ?? legacyBase + legacyIndex++ * 1000,
  }));
}

const defaultCommands = normalizeQuickCommands(preferredLocale === "zh-CN"
  ? [
      { id: "1", label: "清屏", command: "clear", order: 0 },
      { id: "2", label: "列出文件", command: "ls -la", order: 1 },
      { id: "3", label: "当前路径", command: "pwd", order: 2 },
      { id: "4", label: "进程列表", command: "ps aux", order: 3 },
    ]
  : [
      { id: "1", label: "Clear screen", command: "clear", order: 0 },
      { id: "2", label: "List files", command: "ls -la", order: 1 },
      { id: "3", label: "Working directory", command: "pwd", order: 2 },
      { id: "4", label: "Process list", command: "ps aux", order: 3 },
    ]);

export const useQuickCommandsStore = create<QuickCommandsState>()(
  persist(
    (set) => ({
      commands: defaultCommands,

      addCommand: (command) => {
        const id = Math.random().toString(36).substring(2, 11);
        set((state) => {
          const nextOrder = state.commands.reduce(
            (highestOrder, item) => Math.max(highestOrder, item.order),
            -1,
          ) + 1;

          return {
            commands: [
              ...state.commands,
              { ...command, id, order: nextOrder, createdAt: Date.now() },
            ],
          };
        });
      },

      removeCommand: (id) => {
        set((state) => ({
          commands: state.commands
            .filter((cmd) => cmd.id !== id)
            .sort((a, b) => a.order - b.order)
            .map((cmd, index) => ({ ...cmd, order: index })),
        }));
      },

      removeCommands: (ids) => {
        const idSet = new Set(ids);
        set((state) => ({
          commands: state.commands
            .filter((cmd) => !idSet.has(cmd.id))
            .sort((a, b) => a.order - b.order)
            .map((cmd, index) => ({ ...cmd, order: index })),
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
      name: "lazy-term-quick-commands",
      storage: createJSONStorage(() => gitAwareStorage),
      version: 1,
      migrate: (persistedState) => {
        const state = typeof persistedState === "object" && persistedState !== null
          ? persistedState as { commands?: unknown }
          : {};
        return {
          ...state,
          commands: normalizeQuickCommands(state.commands),
        };
      },
    }
  )
);
