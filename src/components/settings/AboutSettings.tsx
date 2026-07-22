import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CloudDownload, Download, RefreshCw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { IS_UPDATE_SUPPORTED } from "@/config/update-config";
import { useI18n } from "@/i18n";
import { notifyUpdateAvailable } from "@/hooks/useUpdateNotification";
import { checkForUpdate, getCurrentAppVersion } from "@/services/updateService";

type UpdateDownloadStatus = {
  downloading: boolean;
  progress: number | null;
  error: string | null;
  downloadedUrl: string | null;
};

/** 关于与更新设置 */
export function AboutSettings() {
  const { t } = useI18n();
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [isChecking, setIsChecking] = useState(false);
  const [latestUpdateUrl, setLatestUpdateUrl] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadedUpdateUrl, setDownloadedUpdateUrl] = useState<string | null>(null);
  const [isUpdateConfirmationOpen, setIsUpdateConfirmationOpen] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    getCurrentAppVersion().then(setVersion);
    let disposed = false;
    let receivedDownloadEvent = false;
    let stopListening: (() => void) | undefined;

    void (async () => {
      const [stopProgressListener, stopErrorListener, stopCompleteListener] = await Promise.all([
        listen<{ progress: number }>("update-progress", (event) => {
          if (!disposed) {
            receivedDownloadEvent = true;
            setDownloadProgress(event.payload.progress);
          }
        }),
        listen<{ error: string }>("update-download-error", (event) => {
          if (!disposed) {
            receivedDownloadEvent = true;
            setDownloadProgress(null);
            setUpdateStatus(t("下载更新包失败：{error}", { error: event.payload.error }));
          }
        }),
        listen<{ url: string }>("update-download-complete", (event) => {
          if (!disposed) {
            receivedDownloadEvent = true;
            setDownloadedUpdateUrl(event.payload.url);
            setDownloadProgress(null);
            setUpdateStatus(t("更新包已下载，可随时安装。"));
          }
        }),
      ]);

      if (disposed) {
        stopProgressListener();
        stopErrorListener();
        stopCompleteListener();
        return;
      }
      stopListening = () => {
        stopProgressListener();
        stopErrorListener();
        stopCompleteListener();
      };

      const status = await invoke<UpdateDownloadStatus>("get_update_download_status");
      if (disposed || receivedDownloadEvent) return;

      if (status.downloading) {
        setDownloadProgress((current) => Math.max(current ?? 0, status.progress ?? 0));
      } else if (status.error) {
        setUpdateStatus(t("下载更新包失败：{error}", { error: status.error }));
      }
      setDownloadedUpdateUrl(status.downloadedUrl);
    })().catch((err) => {
      console.error("Failed to restore update download status", err);
    });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [t]);

  const displayedVersion = version === undefined ? t("加载中...") : (version ?? t("未知"));
  const isUpdateDownloaded = latestUpdateUrl !== null && latestUpdateUrl === downloadedUpdateUrl;

  const checkUpdate = async () => {
    setIsChecking(true);
    setUpdateStatus(t("正在检查更新..."));
    setLatestUpdateUrl(null);
    setDownloadProgress(null);

    try {
      const result = await checkForUpdate();

      if (result.status === "unsupported") {
        setUpdateStatus(t("暂不支持该平台更新"));
        return;
      }

      if (result.status === "available") {
        setUpdateStatus(
          downloadedUpdateUrl === result.downloadUrl
            ? t("更新包已下载，可随时安装。")
            : t("发现新版本：{version}！", { version: result.latestVersion }),
        );
        setLatestUpdateUrl(result.downloadUrl);
        notifyUpdateAvailable(result);
        return;
      }

        setUpdateStatus(t("已是最新版本（{version}）", { version: displayedVersion }));
    } catch (err: unknown) {
      setUpdateStatus(t("检查更新失败：{error}", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsChecking(false);
    }
  };

  const downloadUpdate = async (): Promise<boolean> => {
    const url = latestUpdateUrl;
    if (!url) return false;

    setDownloadProgress(0);
    setUpdateStatus(t("正在下载更新包..."));

    try {
      await invoke("download_update", { url });
      setDownloadedUpdateUrl(url);
      setDownloadProgress(null);
      setUpdateStatus(t("更新包已下载，可随时安装。"));
      return true;
    } catch (err) {
      setDownloadProgress(null);
      setUpdateStatus(t("下载更新包失败：{error}", { error: String(err) }));
      return false;
    }
  };

  const startUpdate = async () => {
    setIsInstalling(true);

    if (!isUpdateDownloaded && !(await downloadUpdate())) {
      setIsInstalling(false);
      return;
    }

    try {
      await invoke("install_update");
    } catch (err) {
      setUpdateStatus(t("安装更新失败：{error}", { error: String(err) }));
      setIsInstalling(false);
    }
  };

  return (
    <>
      <div className="flex flex-col h-full relative">
        <div className="flex flex-col gap-6 pb-10 px-1">
          {/* 关于 */}
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">{t("关于")}</Label>
            <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-base font-semibold">LazyTerm</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t("当前版本：{version}", { version: displayedVersion })}</div>
                </div>
                <Button onClick={checkUpdate} disabled={isChecking || downloadProgress !== null || isInstalling || !IS_UPDATE_SUPPORTED} variant="outline" size="sm" className="h-8 px-3">
                  {isChecking ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5 mr-1.5" />}
                  {!IS_UPDATE_SUPPORTED ? t("暂不支持该平台更新") : t("检查更新")}
                </Button>
              </div>

              {(updateStatus || downloadProgress !== null) && (
                <div className="px-4 py-3">
                  <div className="p-3 rounded-lg bg-primary/10 text-primary text-sm font-medium border border-primary/20 space-y-3">
                    {updateStatus && <div className="leading-relaxed">{updateStatus}</div>}
                    {latestUpdateUrl && downloadProgress === null && (
                      <div className="flex flex-wrap gap-2">
                        {!isUpdateDownloaded && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 bg-background/50"
                            disabled={isInstalling}
                            onClick={() => void downloadUpdate()}
                          >
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            {t("下载更新包")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={isInstalling}
                          onClick={() => setIsUpdateConfirmationOpen(true)}
                        >
                          {t("立即更新")}
                        </Button>
                      </div>
                    )}
                    {downloadProgress !== null && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-medium">
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

      <AlertDialog open={isUpdateConfirmationOpen} onOpenChange={setIsUpdateConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("确认更新 LazyTerm？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {isUpdateDownloaded
                ? t("更新需要关闭 LazyTerm，当前所有会话都将断开。是否继续？")
                : t("LazyTerm 将先下载更新包，下载完成后关闭应用并开始安装。当前所有会话都将断开。是否继续？")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void startUpdate()}>
              {isUpdateDownloaded ? t("关闭并更新") : t("下载并更新")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
