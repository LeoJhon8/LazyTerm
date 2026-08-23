import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  compareVersions,
  GITEE_DOWNLOAD_BASE_URL,
  GITEE_INSTALLER_REGEX,
  GITEE_UPDATE_SERVER_URL,
  GITHUB_RELEASES_API_URL,
  INSTALLER_EXTENSION,
  IS_UPDATE_SUPPORTED,
  UPDATE_SOURCE_TIMEOUT_MS,
} from "@/config/update-config";
import { IS_ANDROID } from "@/lib/platform";

export type UpdateCheckResult =
  | {
      status: "unsupported";
      currentVersion: string | null;
    }
  | {
      status: "up-to-date";
      currentVersion: string;
      latestVersion: string;
    }
  | {
      status: "available";
      currentVersion: string;
      latestVersion: string;
      downloadUrl: string;
      sha256?: string;
    };

export type AvailableUpdateResult = Extract<UpdateCheckResult, { status: "available" }>;

type Installer = {
  version: string;
  downloadUrl: string;
  assetName?: string;
  sha256?: string;
};

type GitHubRelease = {
  tag_name?: unknown;
  assets?: unknown;
};

type GitHubReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
};

function parseGitHubReleaseVersion(release: GitHubRelease): string | null {
  if (typeof release.tag_name !== "string") return null;
  return /^v?(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1] ?? null;
}

function androidAssetMatchesArchitecture(name: string, architecture?: string): boolean {
  const normalizedName = name.toLowerCase();
  if (!normalizedName.includes("android")) return false;
  if (normalizedName.includes("universal")) return true;

  if (!architecture) return true;
  if (architecture === "aarch64") {
    return normalizedName.includes("arm64") || normalizedName.includes("aarch64");
  }
  if (architecture === "x86_64") {
    return normalizedName.includes("x86_64") || normalizedName.includes("x86-64");
  }
  return normalizedName.includes(architecture.toLowerCase());
}

export async function getCurrentAppVersion(): Promise<string | null> {
  try {
    return await getVersion();
  } catch {
    return null;
  }
}

export function findLatestInstaller(htmlText: string, androidArchitecture?: string): Installer | null {
  let latestVersion = "0.0.0";
  let latestDownloadPath = "";
  let match: RegExpExecArray | null;

  GITEE_INSTALLER_REGEX.lastIndex = 0;
  while ((match = GITEE_INSTALLER_REGEX.exec(htmlText)) !== null) {
    const fullHref = match[1];
    const parsedVersion = match[2];

    if (IS_ANDROID && !androidAssetMatchesArchitecture(fullHref, androidArchitecture)) {
      continue;
    }

    if (compareVersions(parsedVersion, latestVersion) > 0) {
      latestVersion = parsedVersion;
      latestDownloadPath = fullHref;
    }
  }
  GITEE_INSTALLER_REGEX.lastIndex = 0;

  if (latestVersion === "0.0.0" || !latestDownloadPath) {
    return null;
  }

  return {
    version: latestVersion,
    downloadUrl: latestDownloadPath.startsWith("http")
      ? latestDownloadPath
      : `${GITEE_DOWNLOAD_BASE_URL}${latestDownloadPath}`,
  };
}

export function findGitHubInstaller(release: GitHubRelease, androidArchitecture?: string): Installer | null {
  const version = parseGitHubReleaseVersion(release);
  if (!version || !Array.isArray(release.assets)) {
    return null;
  }

  const matchingAssets = (release.assets as GitHubReleaseAsset[]).filter((item) => {
    if (typeof item.name !== "string") return false;
    const normalizedName = item.name.toLowerCase();
    if ((!normalizedName.startsWith("lazyterm_") && !normalizedName.startsWith("lazyterm-"))
      || !normalizedName.endsWith(INSTALLER_EXTENSION)) {
      return false;
    }
    return !IS_ANDROID || androidAssetMatchesArchitecture(item.name, androidArchitecture);
  });
  const asset = matchingAssets[0];

  if (!asset || typeof asset.name !== "string" || typeof asset.browser_download_url !== "string") {
    return null;
  }

  return {
    version,
    downloadUrl: asset.browser_download_url,
    assetName: asset.name,
  };
}

async function resolveAndroidArchitecture(): Promise<string | undefined> {
  if (!IS_ANDROID) return undefined;
  try {
    return await invoke<string>("get_android_arch");
  } catch {
    return undefined;
  }
}

async function attachGitHubChecksum(
  release: GitHubRelease,
  installer: Installer,
): Promise<Installer> {
  if (!IS_ANDROID || !installer.assetName || !Array.isArray(release.assets)) {
    return installer;
  }

  const checksumAsset = (release.assets as GitHubReleaseAsset[]).find((item) => (
    typeof item.name === "string"
    && item.name.toLowerCase() === "sha256sums.txt"
    && typeof item.browser_download_url === "string"
  ));
  if (!checksumAsset || typeof checksumAsset.browser_download_url !== "string") {
    return installer;
  }

  try {
    const response = await fetchWithTimeout(checksumAsset.browser_download_url, "text/plain");
    if (!response.ok) return installer;

    const expectedName = installer.assetName.toLowerCase();
    for (const line of (await response.text()).split(/\r?\n/)) {
      const match = /^([a-f\d]{64})\s+\*?(.+)$/i.exec(line.trim());
      if (match && match[2].trim().toLowerCase() === expectedName) {
        return { ...installer, sha256: match[1].toLowerCase() };
      }
    }
  } catch {
    // 校验文件不可用时仍允许下载；安装前还会强制校验 Android 包名和签名证书。
  }
  return installer;
}

async function fetchWithTimeout(
  url: string,
  accept: string,
  method: "GET" | "HEAD" = "GET",
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), UPDATE_SOURCE_TIMEOUT_MS);

  try {
    return await tauriFetch(url, {
      method,
      headers: { Accept: accept },
      connectTimeout: UPDATE_SOURCE_TIMEOUT_MS,
      maxRedirections: 5,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function githubAssetIsReachable(downloadUrl: string): Promise<boolean> {
  const probe = async (method: "HEAD" | "GET") => {
    const response = await fetchWithTimeout(downloadUrl, "*/*", method);
    if (response.body) {
      void response.body.cancel().catch(() => undefined);
    }
    return response;
  };

  const headResponse = await probe("HEAD");
  if (headResponse.ok) {
    return true;
  }

  if (headResponse.status !== 405 && headResponse.status !== 501) {
    return false;
  }

  return (await probe("GET")).ok;
}

async function getLatestInstaller(androidArchitecture?: string): Promise<Installer> {
  const sourceErrors: string[] = [];

  try {
    const githubResponse = await fetchWithTimeout(
      GITHUB_RELEASES_API_URL,
      "application/vnd.github+json",
    );

    if (!githubResponse.ok) {
      throw new Error(`HTTP ${githubResponse.status}`);
    }

    const release = (await githubResponse.json()) as GitHubRelease;
    const installer = findGitHubInstaller(release, androidArchitecture);
    if (!installer) {
      throw new Error("未找到当前平台的有效安装包");
    }

    if (!(await githubAssetIsReachable(installer.downloadUrl))) {
      throw new Error("安装包下载链路不可用");
    }

    return await attachGitHubChecksum(release, installer);
  } catch (error) {
    sourceErrors.push(`GitHub: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const giteeResponse = await fetchWithTimeout(GITEE_UPDATE_SERVER_URL, "text/html");
    if (!giteeResponse.ok) {
      throw new Error(`HTTP ${giteeResponse.status}`);
    }

    const installer = findLatestInstaller(await giteeResponse.text(), androidArchitecture);
    if (!installer) {
      throw new Error("未找到当前平台的有效安装包");
    }

    return installer;
  } catch (error) {
    sourceErrors.push(`Gitee: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(`所有更新源均不可用（${sourceErrors.join("；")}）`);
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = await getCurrentAppVersion();

  if (!IS_UPDATE_SUPPORTED) {
    return {
      status: "unsupported",
      currentVersion,
    };
  }

  const resolvedCurrentVersion = currentVersion ?? "0.0.0";
  const androidArchitecture = await resolveAndroidArchitecture();

  if (IS_ANDROID) {
    try {
      const response = await fetchWithTimeout(
        GITHUB_RELEASES_API_URL,
        "application/vnd.github+json",
      );
      if (response.ok) {
        const latestVersion = parseGitHubReleaseVersion((await response.json()) as GitHubRelease);
        if (latestVersion && compareVersions(latestVersion, resolvedCurrentVersion) <= 0) {
          return {
            status: "up-to-date",
            currentVersion: resolvedCurrentVersion,
            latestVersion,
          };
        }
      }
    } catch {
      // 元数据预检失败时继续走原有的 GitHub → Gitee 更新源回退。
    }
  }

  const latestInstaller = await getLatestInstaller(androidArchitecture);

  if (compareVersions(latestInstaller.version, resolvedCurrentVersion) > 0) {
    return {
      status: "available",
      currentVersion: resolvedCurrentVersion,
      latestVersion: latestInstaller.version,
      downloadUrl: latestInstaller.downloadUrl,
      sha256: latestInstaller.sha256,
    };
  }

  return {
    status: "up-to-date",
    currentVersion: resolvedCurrentVersion,
    latestVersion: latestInstaller.version,
  };
}
