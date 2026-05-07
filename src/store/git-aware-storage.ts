/**
 * Git 目录感知的 Zustand 持久化存储适配器
 *
 * 当配置了 gitRepoPath 时，用户配置数据自动保存到 git 目录下；
 * 否则回退到浏览器 localStorage。
 *
 * 核心设计原则：
 * - 文件系统与 localStorage 双写，保持数据一致性
 * - 写入立即执行（无防抖），确保导入/恢复等操作后数据立刻落盘
 * - 读取时文件系统优先，文件不存在则从 localStorage 自动迁移
 * - 提供显式 syncToGitDir() 函数，供导入等关键操作后强制同步
 *
 * 文件存储结构：
 *   {gitRepoPath}/lazy-term/
 *     ├── settings.json        （应用设置）
 *     ├── profiles.json        （会话档案）
 *     ├── history.json         （历史命令）
 *     ├── quick-commands.json  （快捷命令）
 *     └── slot-config.json     （布局配置）
 */

import type { StateStorage } from "zustand/middleware";
import { readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { useGitSyncStore } from "@/store/git-sync";
import { logger } from "@/lib/logger";

/** git 目录下的配置子目录名 */
const CONFIG_DIR_NAME = "lazy-term";

/** 各 localStorage key 对应的文件名映射 */
const KEY_TO_FILE: Record<string, string> = {
  "lazy-term-settings": "settings.json",
  "terminal-sessions-v10": "profiles.json",
  "lazy-term-history": "history.json",
  "lazy-term-quick-commands": "quick-commands.json",
  "lazy-term-slot-config": "slot-config.json",
};

/** 需要忽略的 store key（git-sync 自身存 localStorage） */
const IGNORED_KEYS = new Set(["lazy-term-git-sync"]);

/** 内存缓存，避免频繁读取文件系统 */
const memoryCache = new Map<string, string>();

/**
 * 将路径分隔符统一为正斜杠
 * Tauri 的 fs 插件在 Windows 上也接受正斜杠路径
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * 获取 git 目录下的配置目录完整路径
 */
function getConfigDirPath(): string | null {
  const { gitRepoPath } = useGitSyncStore.getState();
  if (!gitRepoPath) return null;
  return `${normalizePath(gitRepoPath)}/${CONFIG_DIR_NAME}`;
}

/**
 * 获取 git 目录下的配置文件完整路径
 */
function getConfigFilePath(fileName: string): string | null {
  const dirPath = getConfigDirPath();
  if (!dirPath) return null;
  return `${dirPath}/${fileName}`;
}

/**
 * 确保配置目录存在
 */
async function ensureConfigDir(): Promise<string | null> {
  const dirPath = getConfigDirPath();
  if (!dirPath) return null;

  try {
    const dirExists = await exists(dirPath);
    if (!dirExists) {
      await mkdir(dirPath, { recursive: true });
      logger.info("GitAwareStorage", "创建配置目录成功", { dirPath });
    }
    return dirPath;
  } catch (error) {
    logger.error("GitAwareStorage", "创建配置目录失败", { dirPath, error });
    return null;
  }
}

/**
 * 将 localStorage key 映射为文件名
 */
function keyToFileName(key: string): string | null {
  return KEY_TO_FILE[key] ?? null;
}

/**
 * 立即将数据写入 git 目录下的配置文件
 * 如果写入失败，详细记录日志，不阻塞主流程
 */
async function writeConfigFile(key: string, value: string): Promise<boolean> {
  const fileName = keyToFileName(key);
  if (!fileName) return false;

  const filePath = getConfigFilePath(fileName);
  if (!filePath) return false;

  try {
    const dirPath = await ensureConfigDir();
    if (!dirPath) {
      logger.error("GitAwareStorage", "无法确保目录存在，跳过文件写入", { key, filePath });
      return false;
    }

    await writeTextFile(filePath, value);
    memoryCache.set(key, value);
    logger.info("GitAwareStorage", "写入配置文件成功", { key, fileName });
    return true;
  } catch (error) {
    logger.error("GitAwareStorage", "写入配置文件失败", { key, filePath, error });
    return false;
  }
}

/**
 * Git 目录感知的 Zustand 存储适配器
 */
export const gitAwareStorage: StateStorage = {
  getItem: async (key: string): Promise<string | null> => {
    // git-sync store 自身始终用 localStorage
    if (IGNORED_KEYS.has(key)) {
      return localStorage.getItem(key);
    }

    const fileName = keyToFileName(key);
    const filePath = fileName ? getConfigFilePath(fileName) : null;

    // git 目录未配置时回退到 localStorage
    if (!filePath) {
      return localStorage.getItem(key);
    }

    try {
      // 先查内存缓存
      if (memoryCache.has(key)) {
        return memoryCache.get(key) ?? null;
      }

      const fileExists = await exists(filePath);
      if (fileExists) {
        const content = await readTextFile(filePath);
        // 空文件视为不存在（removeItem 时写入空内容标记删除）
        if (content === "") {
          return null;
        }
        memoryCache.set(key, content);
        return content;
      }

      // 文件不存在，尝试从 localStorage 迁移
      const localData = localStorage.getItem(key);
      if (localData) {
        // 自动迁移：将 localStorage 数据写入 git 目录
        await writeConfigFile(key, localData);
        logger.info("GitAwareStorage", "已从 localStorage 迁移配置到 git 目录", { key });
      }
      return localData;
    } catch (error) {
      logger.error("GitAwareStorage", "读取配置文件失败，回退到 localStorage", { filePath, error });
      return localStorage.getItem(key);
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    // git-sync store 自身始终用 localStorage
    if (IGNORED_KEYS.has(key)) {
      localStorage.setItem(key, value);
      return;
    }

    // 始终同步写一份到 localStorage 作为备份
    try {
      localStorage.setItem(key, value);
    } catch {
      // localStorage 满了则忽略
    }

    // 更新内存缓存
    memoryCache.set(key, value);

    // 立即写入文件系统（不再防抖，确保数据一致性）
    await writeConfigFile(key, value);
  },

  removeItem: async (key: string): Promise<void> => {
    if (IGNORED_KEYS.has(key)) {
      localStorage.removeItem(key);
      return;
    }

    memoryCache.delete(key);
    localStorage.removeItem(key);

    // 文件系统层面：写入空内容标记删除
    const fileName = keyToFileName(key);
    const filePath = fileName ? getConfigFilePath(fileName) : null;
    if (!filePath) return;

    try {
      const fileExists = await exists(filePath);
      if (fileExists) {
        await writeTextFile(filePath, "");
      }
    } catch (error) {
      logger.error("GitAwareStorage", "删除配置文件失败", { filePath, error });
    }
  },
};

/**
 * 清除内存缓存
 * 当 gitRepoPath 变更时调用，强制下次读取时重新从文件系统加载
 */
export function invalidateCache(): void {
  memoryCache.clear();
}

/**
 * 当 gitRepoPath 变更时，将当前所有 store 数据迁移到新的 git 目录
 */
export async function migrateToGitDir(): Promise<void> {
  const { gitRepoPath } = useGitSyncStore.getState();
  if (!gitRepoPath) return;

  const dirPath = await ensureConfigDir();
  if (!dirPath) {
    logger.error("GitAwareStorage", "迁移失败：无法创建配置目录");
    return;
  }

  for (const [localStorageKey, fileName] of Object.entries(KEY_TO_FILE)) {
    const localData = localStorage.getItem(localStorageKey);
    if (!localData) continue;

    const filePath = `${dirPath}/${fileName}`;

    try {
      const fileExists = await exists(filePath);
      if (!fileExists) {
        await writeTextFile(filePath, localData);
        memoryCache.set(localStorageKey, localData);
        logger.info("GitAwareStorage", "迁移配置到 git 目录", { fileName });
      } else {
        // 文件已存在，更新内存缓存以保持一致
        memoryCache.set(localStorageKey, localData);
      }
    } catch (error) {
      logger.error("GitAwareStorage", "迁移配置失败", { fileName, error });
    }
  }
}

/**
 * 显式同步：将所有 store 的当前数据写入 git 目录
 *
 * 适用场景：导入/恢复等关键操作后，需要确保数据已落盘。
 * Zustand persist 中间件的 setItem 是异步的且不被 await，
 * 此函数提供一种确定性的同步机制。
 *
 * @returns 成功写入的文件数量
 */
export async function syncToGitDir(): Promise<number> {
  const { gitRepoPath } = useGitSyncStore.getState();
  if (!gitRepoPath) return 0;

  const dirPath = await ensureConfigDir();
  if (!dirPath) {
    logger.error("GitAwareStorage", "同步失败：无法创建配置目录");
    return 0;
  }

  let successCount = 0;

  for (const [localStorageKey, fileName] of Object.entries(KEY_TO_FILE)) {
    const localData = localStorage.getItem(localStorageKey);
    if (!localData) continue;

    const filePath = `${dirPath}/${fileName}`;

    try {
      await writeTextFile(filePath, localData);
      memoryCache.set(localStorageKey, localData);
      successCount++;
      logger.info("GitAwareStorage", "同步配置到 git 目录", { fileName });
    } catch (error) {
      logger.error("GitAwareStorage", "同步配置失败", { fileName, error });
    }
  }

  return successCount;
}
