/**
 * Git 目录感知的 Zustand 持久化存储适配器
 * 
 * 架构重构（单文件模式）：
 * 1. localStorage 是主数据源 (Source of Truth)。
 * 2. 所有配置合并存储于 Git 仓库根目录下的单文件：lazy-term-config.json。
 * 3. 这种设计极大简化了 Git 仓库的文件结构，方便用户管理。
 */

import type { StateStorage } from "zustand/middleware";
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { logger } from "@/lib/logger";

/** Git 仓库中的单配置文件名 */
export const CONFIG_FILE_NAME = "lazy-term-config.json";

/** 需要同步到 Git 的 localStorage key 列表 */
const SYNC_KEYS = [
  "lazy-term-settings",
  "terminal-sessions-v10",
  "lazy-term-quick-commands",
  "lazy-term-slot-config",
  "lazy-term-credentials",
];

/** 需要忽略的 store key（git-sync 自身存 localStorage，避免循环） */

/**
 * 将路径分隔符统一为正斜杠
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * 获取 Git 仓库根目录路径
 */
function getGitRepoPath(): string | null {
  try {
    const raw = localStorage.getItem("lazy-term-git-sync");
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed.state?.gitRepoPath || null;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * 获取配置文件完整路径
 */
function getConfigFilePath(): string | null {
  const repoPath = getGitRepoPath();
  if (!repoPath) return null;
  return `${normalizePath(repoPath)}/${CONFIG_FILE_NAME}`;
}

/**
 * 核心写入逻辑：将 localStorage 中所有相关键值打包写入单文件
 * 
 * 使用简易的互斥机制防止并发写入冲突
 */
let isWriting = false;
async function writeAllToDisk(): Promise<boolean> {
  if (isWriting) return false; // 如果正在写入，跳过本次（由后续触发或手动同步补全）
  
  const filePath = getConfigFilePath();
  if (!filePath) return false;

  isWriting = true;
  try {
    const configBundle: Record<string, unknown> = {};
    for (const key of SYNC_KEYS) {
      const value = localStorage.getItem(key);
      if (value) {
        try {
          // 解析 localStorage 中的字符串，以避免在最终 JSON 中产生双重转义
          configBundle[key] = JSON.parse(value);
        } catch {
          configBundle[key] = value;
        }
      }
    }

    await writeTextFile(filePath, JSON.stringify(configBundle, null, 2));
    logger.debug("GitAwareStorage", "Successfully synced all config to lazy-term-config.json");
    return true;
  } catch (error) {
    logger.error("GitAwareStorage", "Failed to write config bundle", { error });
    return false;
  } finally {
    isWriting = false;
  }
}

/**
 * Git 目录感知的 Zustand 存储适配器
 */
export const gitAwareStorage: StateStorage = {
  getItem: (key: string): string | null => {
    // 始终从 localStorage 读取，性能最优
    return localStorage.getItem(key);
  },

  setItem: (key: string, value: string): void => {
    // 仅更新主数据源 localStorage
    localStorage.setItem(key, value);
  },

  removeItem: (key: string): void => {
    localStorage.removeItem(key);
  },
};

/**
 * 从 Git 配置文件强制同步到 localStorage
 */
export async function syncFromGitDir(): Promise<number> {
  const filePath = getConfigFilePath();
  if (!filePath) return 0;

  try {
    if (await exists(filePath)) {
      const content = await readTextFile(filePath);
      if (!content) return 0;

      const configBundle = JSON.parse(content);
      let successCount = 0;

      for (const [key, value] of Object.entries(configBundle)) {
        if (value !== null && value !== undefined) {
          // 将对象转回字符串存入 localStorage
          const stringValue = typeof value === "string" ? value : JSON.stringify(value);
          localStorage.setItem(key, stringValue);
          successCount++;
        }
      }
      
      logger.info("GitAwareStorage", `Synced ${successCount} items from lazy-term-config.json`);
      return successCount;
    }
  } catch (error) {
    logger.error("GitAwareStorage", "Failed to sync from Git config file", { error });
  }

  return 0;
}

/**
 * 显式同步到 Git 目录
 */
export async function syncToGitDir(): Promise<number> {
  const success = await writeAllToDisk();
  return success ? SYNC_KEYS.length : 0;
}

/**
 * 兼容性保留方法
 */
export function invalidateCache(): void {}
export async function migrateToGitDir(): Promise<void> {
  await syncToGitDir();
}
