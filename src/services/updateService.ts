import { getVersion } from "@tauri-apps/api/app";
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
    };

export type AvailableUpdateResult = Extract<UpdateCheckResult, { status: "available" }>;

type Installer = {
  version: string;
  downloadUrl: string;
};

type GitHubRelease = {
  tag_name?: unknown;
  assets?: unknown;
};

type GitHubReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
};

export async function getCurrentAppVersion(): Promise<string | null> {
  try {
    return await getVersion();
  } catch {
    return null;
  }
}

export function findLatestInstaller(htmlText: string): Installer | null {
  let latestVersion = "0.0.0";
  let latestDownloadPath = "";
  let match: RegExpExecArray | null;

  GITEE_INSTALLER_REGEX.lastIndex = 0;
  while ((match = GITEE_INSTALLER_REGEX.exec(htmlText)) !== null) {
    const fullHref = match[1];
    const parsedVersion = match[2];

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

export function findGitHubInstaller(release: GitHubRelease): Installer | null {
  if (typeof release.tag_name !== "string") {
    return null;
  }

  const versionMatch = /^v?(\d+\.\d+\.\d+)$/.exec(release.tag_name);
  if (!versionMatch || !Array.isArray(release.assets)) {
    return null;
  }

  const asset = (release.assets as GitHubReleaseAsset[]).find(
    (item) =>
      typeof item.name === "string" &&
      item.name.toLowerCase().startsWith("lazyterm_") &&
      item.name.toLowerCase().endsWith(INSTALLER_EXTENSION),
  );

  if (!asset || typeof asset.browser_download_url !== "string") {
    return null;
  }

  return {
    version: versionMatch[1],
    downloadUrl: asset.browser_download_url,
  };
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

async function getLatestInstaller(): Promise<Installer> {
  const sourceErrors: string[] = [];

  try {
    const githubResponse = await fetchWithTimeout(
      GITHUB_RELEASES_API_URL,
      "application/vnd.github+json",
    );

    if (!githubResponse.ok) {
      throw new Error(`HTTP ${githubResponse.status}`);
    }

    const installer = findGitHubInstaller((await githubResponse.json()) as GitHubRelease);
    if (!installer) {
      throw new Error("未找到当前平台的有效安装包");
    }

    if (!(await githubAssetIsReachable(installer.downloadUrl))) {
      throw new Error("安装包下载链路不可用");
    }

    return installer;
  } catch (error) {
    sourceErrors.push(`GitHub: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const giteeResponse = await fetchWithTimeout(GITEE_UPDATE_SERVER_URL, "text/html");
    if (!giteeResponse.ok) {
      throw new Error(`HTTP ${giteeResponse.status}`);
    }

    const installer = findLatestInstaller(await giteeResponse.text());
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
  const latestInstaller = await getLatestInstaller();

  if (compareVersions(latestInstaller.version, resolvedCurrentVersion) > 0) {
    return {
      status: "available",
      currentVersion: resolvedCurrentVersion,
      latestVersion: latestInstaller.version,
      downloadUrl: latestInstaller.downloadUrl,
    };
  }

  return {
    status: "up-to-date",
    currentVersion: resolvedCurrentVersion,
    latestVersion: latestInstaller.version,
  };
}
