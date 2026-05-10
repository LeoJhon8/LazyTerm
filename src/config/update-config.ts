/**
 * 更新服务配置
 * 将硬编码的更新服务器地址抽取为配置项
 */

/** 更新检查服务器基础 URL */
export const UPDATE_SERVER_URL = "https://gitee.com/ONE_FOR_EGG/lazy-term-releases/releases/";

/** 更新下载服务器基础 URL */
export const UPDATE_DOWNLOAD_BASE_URL = "https://gitee.com";

/** 同步文件名 */
export const SYNC_FILE_NAME = "lazy-term-sync.json";

/** 自动检测当前平台 */
export const IS_MAC = typeof window !== "undefined" && navigator.userAgent.toLowerCase().includes("mac");
export const IS_WINDOWS = typeof window !== "undefined" && navigator.userAgent.toLowerCase().includes("windows");
export const IS_UPDATE_SUPPORTED = IS_MAC || IS_WINDOWS;

/** 安装包匹配正则（区分 Windows 和 Mac） */
export const INSTALLER_REGEX = IS_MAC 
  ? /href="([^"]*LazyTerm[_-]?v?(\d+\.\d+\.\d+)[^"]*\.dmg)"/gi
  : /href="([^"]*LazyTerm[_-]?v?(\d+\.\d+\.\d+)[^"]*\.exe)"/gi;

/** 版本号比较 */
export function compareVersions(v1: string, v2: string): number {
  const p1 = v1.split(".").map(Number);
  const p2 = v2.split(".").map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}
