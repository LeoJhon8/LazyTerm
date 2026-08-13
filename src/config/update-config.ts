/**
 * 更新服务配置
 * 将硬编码的更新服务器地址抽取为配置项
 */

/** GitHub Releases API：优先使用公开 Release。 */
export const GITHUB_RELEASES_API_URL =
  "https://api.github.com/repos/LeoJhon8/LazyTerm/releases/latest";

/** Gitee 更新页：GitHub 不可用时回退。 */
export const GITEE_UPDATE_SERVER_URL =
  "https://gitee.com/LeoJohn8/LazyTerm/releases/";

/** Gitee 相对下载链接的基础 URL。 */
export const GITEE_DOWNLOAD_BASE_URL = "https://gitee.com";

/** 避免 GitHub 网络异常长时间阻塞 Gitee 回退。 */
export const UPDATE_SOURCE_TIMEOUT_MS = 5_000;

/** 同步文件名 */
export const SYNC_FILE_NAME = "lazy-term-sync.json";

/** 自动检测当前平台 */
export const IS_MAC = typeof window !== "undefined" && navigator.userAgent.toLowerCase().includes("mac");
export const IS_WINDOWS = typeof window !== "undefined" && navigator.userAgent.toLowerCase().includes("windows");
export const IS_UPDATE_SUPPORTED = IS_MAC || IS_WINDOWS;

/** Gitee 更新页安装包匹配正则（区分 Windows 和 macOS）。 */
export const GITEE_INSTALLER_REGEX = IS_MAC
  ? /href="([^"]*LazyTerm[_-]?v?(\d+\.\d+\.\d+)[^"]*\.dmg)"/gi
  : /href="([^"]*LazyTerm[_-]?v?(\d+\.\d+\.\d+)[^"]*\.exe)"/gi;

/** GitHub Release 资产扩展名。 */
export const INSTALLER_EXTENSION = IS_MAC ? ".dmg" : ".exe";

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
