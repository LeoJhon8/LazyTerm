/**
 * 更新服务配置
 * 将硬编码的更新服务器地址抽取为配置项
 */

/** 更新检查服务器基础 URL */
export const UPDATE_SERVER_URL = "http://172.50.0.243/";

/** 同步文件名 */
export const SYNC_FILE_NAME = "lazy-term-sync.json";

/** 安装包匹配正则（支持 LazyTerm_版本号_架构-setup.exe 等格式） */
export const INSTALLER_REGEX =
  /href="([^"]*LazyTerm[_-]?v?(\d+\.\d+\.\d+)[^"]*\.(?:exe|msi|zip|dmg|AppImage))"/gi;

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
