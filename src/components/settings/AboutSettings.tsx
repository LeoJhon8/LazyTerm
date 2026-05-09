import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { UPDATE_SERVER_URL, UPDATE_DOWNLOAD_BASE_URL, INSTALLER_REGEX, compareVersions } from "@/config/update-config";
import { CloudDownload, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";

/** 关于与更新设置 */
export function AboutSettings() {
  const { t } = useI18n();
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [isChecking, setIsChecking] = useState(false);
  const [latestUpdateUrl, setLatestUpdateUrl] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
    const unlisten = listen("update-progress", (event: { payload: { progress: number } }) => {
      setDownloadProgress(event.payload.progress);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  const displayedVersion = version === undefined ? t("加载中...") : (version ?? t("未知"));
  const currentVersion = version ?? "0.0.0";

  const checkUpdate = async () => {
    setIsChecking(true);
    setUpdateStatus(t("正在检查更新..."));
    setLatestUpdateUrl(null);
    setDownloadProgress(null);
    try {
      const res = await tauriFetch(UPDATE_SERVER_URL, { method: "GET" });
      if (!res.ok) throw new Error(t("HTTP 错误 {status}", { status: res.status }));
      const htmlText = await res.text();
      let maxVersion = "0.0.0";
      let latestDownloadPath = "";
      let match: RegExpExecArray | null;
      while ((match = INSTALLER_REGEX.exec(htmlText)) !== null) {
        const fullHref = match[1];
        const parsedVersion = match[2];
        if (compareVersions(parsedVersion, maxVersion) > 0) {
          maxVersion = parsedVersion;
          latestDownloadPath = fullHref;
        }
      }
      if (maxVersion === "0.0.0") throw new Error(t("未找到有效的安装包"));
      if (compareVersions(maxVersion, currentVersion) > 0) {
        setUpdateStatus(t("发现新版本：{version}！", { version: maxVersion }));
        const downloadUrl = latestDownloadPath.startsWith('http') 
          ? latestDownloadPath 
          : `${UPDATE_DOWNLOAD_BASE_URL}${latestDownloadPath}`;
        setLatestUpdateUrl(downloadUrl);
      } else {
        setUpdateStatus(t("当前已是最新版本 ({version})", { version: displayedVersion }));
      }
    } catch (err: unknown) {
      setUpdateStatus(t("检查更新失败：{error}", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex flex-col gap-6 pb-10 px-1">

        {/* 关于 */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">{t("关于")}</Label>
          <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-base font-bold">LazyTerm</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t("当前版本：{version}", { version: displayedVersion })}</div>
              </div>
              <Button onClick={checkUpdate} disabled={isChecking || downloadProgress !== null} variant="outline" size="sm" className="h-8 px-3">
                {isChecking ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5 mr-1.5" />}
                {t("检查更新")}
              </Button>
            </div>

            {updateStatus && (
              <div className="px-4 py-3">
                <div className="p-3 rounded-lg bg-primary/10 text-primary text-sm font-medium border border-primary/20 space-y-3">
                  <div className="leading-relaxed">{updateStatus}</div>
                  {latestUpdateUrl && downloadProgress === null && (
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => {
                        setDownloadProgress(0);
                        invoke("download_and_install_update", { url: latestUpdateUrl })
                          .catch(err => {
                            setUpdateStatus(t("下载或安装失败：{error}", { error: String(err) }));
                            setDownloadProgress(null);
                          });
                      }}
                    >
                      {t("立即更新")}
                    </Button>
                  )}
                  {downloadProgress !== null && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="animate-pulse">{t("正在下载更新包...")}</span>
                        <span className="font-mono">{downloadProgress.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-background/50 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-primary h-full transition-all duration-300 ease-out rounded-full"
                          style={{ width: `${downloadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
