import { invokeTauri } from "@/services/tauri";
import type { ShellInfo } from "@/types/shell";

// 内存缓存
let cachedShells: ShellInfo[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 30000; // 30 秒缓存

/**
 * 获取可用的 Shell 列表
 * 带有内存缓存，避免短时间内重复调用后端
 */
export async function getAvailableShells(): Promise<ShellInfo[]> {
  const now = Date.now();
  
  if (cachedShells && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedShells;
  }

  try {
    const shells = await invokeTauri<ShellInfo[]>("get_available_shells", undefined, {
      scope: "FE/service/shell",
      logSuccess: false,
    });
    
    cachedShells = shells;
    cacheTimestamp = now;
    return shells;
  } catch (error) {
    // 如果缓存存在但过期，返回过期缓存作为降级
    if (cachedShells) {
      return cachedShells;
    }
    throw error;
  }
}

/**
 * 清除 Shell 列表缓存
 * 在需要强制刷新时调用
 */
export function clearShellCache(): void {
  cachedShells = null;
  cacheTimestamp = 0;
}
