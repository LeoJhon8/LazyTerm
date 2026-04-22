import { invokeTauri } from "@/services/tauri";
import type { ShellInfo } from "@/types/shell";

// 应用生命周期内永久缓存（Shell 列表在运行期间不会变化）
let cachedShells: ShellInfo[] | null = null;
let initPromise: Promise<ShellInfo[]> | null = null;

/**
 * 获取可用的 Shell 列表
 * 仅在首次调用时执行后端检测，后续直接返回缓存
 */
export async function getAvailableShells(): Promise<ShellInfo[]> {
  if (cachedShells) {
    return cachedShells;
  }

  // 防止并发调用时重复执行检测
  if (initPromise) {
    return initPromise;
  }

  initPromise = invokeTauri<ShellInfo[]>("get_available_shells", undefined, {
    scope: "FE/service/shell",
    logSuccess: false,
  }).then((shells) => {
    cachedShells = shells;
    return shells;
  }).catch((error) => {
    // 检测失败时重置，允许下次重试
    initPromise = null;
    throw error;
  });

  return initPromise;
}

/**
 * 清除 Shell 列表缓存
 * 仅在需要强制刷新时调用
 */
export function clearShellCache(): void {
  cachedShells = null;
  initPromise = null;
}
