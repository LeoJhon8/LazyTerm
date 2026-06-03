import { getVersion } from "@tauri-apps/api/app";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  compareVersions,
  INSTALLER_REGEX,
  IS_UPDATE_SUPPORTED,
  UPDATE_DOWNLOAD_BASE_URL,
  UPDATE_SERVER_URL,
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

export async function getCurrentAppVersion(): Promise<string | null> {
  try {
    return await getVersion();
  } catch {
    return null;
  }
}

export function findLatestInstaller(htmlText: string): { version: string; downloadUrl: string } | null {
  let latestVersion = "0.0.0";
  let latestDownloadPath = "";
  let match: RegExpExecArray | null;

  INSTALLER_REGEX.lastIndex = 0;
  while ((match = INSTALLER_REGEX.exec(htmlText)) !== null) {
    const fullHref = match[1];
    const parsedVersion = match[2];

    if (compareVersions(parsedVersion, latestVersion) > 0) {
      latestVersion = parsedVersion;
      latestDownloadPath = fullHref;
    }
  }
  INSTALLER_REGEX.lastIndex = 0;

  if (latestVersion === "0.0.0" || !latestDownloadPath) {
    return null;
  }

  return {
    version: latestVersion,
    downloadUrl: latestDownloadPath.startsWith("http")
      ? latestDownloadPath
      : `${UPDATE_DOWNLOAD_BASE_URL}${latestDownloadPath}`,
  };
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
  const res = await tauriFetch(UPDATE_SERVER_URL, { method: "GET" });

  if (!res.ok) {
    throw new Error(`HTTP 错误 ${res.status}`);
  }

  const latestInstaller = findLatestInstaller(await res.text());

  if (!latestInstaller) {
    throw new Error("未找到有效的安装包");
  }

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
