import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useSshProfilesStore } from "@/store/ssh-profiles";
import { useQuickCommandsStore } from "@/store/quick-commands";
import { useTabsStore } from "@/store/tabs";
import { useGitSyncStore } from "@/store/git-sync";
import { invalidateCache, syncToGitDir } from "@/store/git-aware-storage";
import { checkGitRepo, commitAndPushGitRepo, pullGitRepo } from "@/services/gitService";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { FileJson, Upload, Trash2, Send, Download, FolderOpen } from "lucide-react";
import { useI18n } from "@/i18n";

export function DataSettings() {
  const { t } = useI18n();
  const { importProfiles, exportProfiles } = useSshProfilesStore();
  const { commands } = useQuickCommandsStore();
  const { sessions } = useTabsStore();

  const [selectedImportFile, setSelectedImportFile] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const { gitRepoPath, setGitRepoPath, lastSyncTime, setLastSyncTime } = useGitSyncStore();
  const [isSyncing, setIsSyncing] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [pendingRestoreData, setPendingRestoreData] = useState<unknown>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

  const buildExportData = () => ({
    version: "1.0",
    exportDate: new Date().toISOString(),
    sshProfiles: exportProfiles(),
    quickCommands: commands,
    sessions: sessions.map(s => ({ title: s.title, type: s.type, cwd: s.cwd, host: s.host, config: s.config })),
  });

  const handleExportAll = async () => {
    try {
      const jsonString = JSON.stringify(buildExportData(), null, 2);
      const defaultFileName = `lazy-term-backup-${new Date().toISOString().split("T")[0]}.json`;
      const filePath = await save({
        title: t("保存备份文件"), defaultPath: defaultFileName,
        filters: [{ name: t("JSON 配置文件"), extensions: ["json"] }, { name: t("所有文件"), extensions: ["*"] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, jsonString);
      setImportMessage(t("备份成功！文件已保存至：{path}", { path: filePath }));
      setMessageType("success");
    } catch (error: unknown) {
      logger.error("FE/settings/data", "Failed to export backup", { error });
      setImportMessage(t("备份失败：{error}", { error: getErrorMessage(error) }));
      setMessageType("error");
    }
  };

  const restoreFromBackup = (rawJson: string) => {
    try {
      const data = JSON.parse(rawJson);
      if (!data.version) throw new Error(t("无效的导入文件格式"));
      setPendingRestoreData(data);
      setRestoreConfirmOpen(true);
    } catch (error: unknown) {
      setImportMessage(t("恢复失败：{error}", { error: getErrorMessage(error) }));
      setMessageType("error");
    }
  };

  const handleConfirmRestore = async () => {
    const data = pendingRestoreData as Record<string, unknown> | null;
    if (!data) return;
    let importedCount = 0;
    if (data.sshProfiles && Array.isArray(data.sshProfiles)) { importProfiles(data.sshProfiles); importedCount += data.sshProfiles.length; }
    if (data.quickCommands && Array.isArray(data.quickCommands)) { useQuickCommandsStore.setState({ commands: data.quickCommands }); importedCount += data.quickCommands.length; }
    setPendingRestoreData(null);
    setRestoreConfirmOpen(false);

    // 导入后显式同步到 git 目录（persist 的 setItem 是异步的且不被 await）
    if (useGitSyncStore.getState().gitRepoPath) {
      try {
        const synced = await syncToGitDir();
        setImportMessage(t("成功恢复 {count} 条配置数据！已同步 {synced} 个文件到 git 目录", { count: importedCount, synced }));
      } catch {
        setImportMessage(t("成功恢复 {count} 条配置数据！但同步到 git 目录失败", { count: importedCount }));
      }
    } else {
      setImportMessage(t("成功恢复 {count} 条配置数据！", { count: importedCount }));
    }
    setMessageType("success");
  };

  const handleImportFromFile = async () => {
    try {
      const selected = await openDialog({
        title: t("选择备份文件"), multiple: false,
        filters: [{ name: t("JSON 配置文件"), extensions: ["json"] }, { name: t("所有文件"), extensions: ["*"] }],
      });
      if (!selected || Array.isArray(selected)) return;
      setSelectedImportFile(selected);
      const rawJson = await readTextFile(selected);
      restoreFromBackup(rawJson);
    } catch (error: unknown) {
      setImportMessage(t("读取备份文件失败：{error}", { error: getErrorMessage(error) }));
      setMessageType("error");
    }
  };

  const handleConfirmClear = () => {
    useSshProfilesStore.setState({ nodes: [{ id: "root-folder", type: "folder", name: t("我的会话"), parentId: null, isExpanded: true, isRoot: true, order: 0 }] });
    useQuickCommandsStore.setState({ commands: [] });
    setSelectedImportFile(null);
    setImportMessage(t("所有配置数据已清空！"));
    setMessageType("success");
    setClearConfirmOpen(false);
  };

  const handleSelectGitRepo = async () => {
    try {
      const selected = await openDialog({ title: t("选择本地 Git 仓库文件夹"), directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        const isRepo = await checkGitRepo(selected);
        if (!isRepo) { setImportMessage(t("该文件夹不是一个有效的 Git 仓库，请先初始化")); setMessageType("error"); }
        else { setImportMessage(t("成功设置 Git 同步目录")); setMessageType("success"); }
        setGitRepoPath(selected);
      }
    } catch (e) { setImportMessage(String(e)); setMessageType("error"); }
  };

  const handleGitPush = async () => {
    if (!gitRepoPath) return;
    setIsSyncing(true); setImportMessage(t("正在推送配置...")); setMessageType("success");
    try {
      // 配置数据已自动保存在 git 目录下，直接 commit & push 即可
      await commitAndPushGitRepo(gitRepoPath, "Auto sync config " + new Date().toISOString());
      setLastSyncTime(Date.now());
      setImportMessage(t("同步推送成功！")); setMessageType("success");
    } catch (e) { setImportMessage(t("推送失败：{error}", { error: String(e) })); setMessageType("error"); }
    finally { setIsSyncing(false); }
  };

  const handleGitPull = async () => {
    if (!gitRepoPath) return;
    setIsSyncing(true); setImportMessage(t("正在拉取配置...")); setMessageType("success");
    try {
      await pullGitRepo(gitRepoPath);
      // 清除内存缓存，让各 store 重新从 git 目录读取最新配置
      invalidateCache();
      // 重新加载页面以应用新配置
      setLastSyncTime(Date.now());
      setImportMessage(t("同步拉取成功！配置将在刷新后生效。")); setMessageType("success");
      // 自动刷新页面以加载新配置
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) { setImportMessage(t("拉取失败：{error}", { error: String(e) })); setMessageType("error"); }
    finally { setIsSyncing(false); }
  };

  const selectedFileName = selectedImportFile?.split(/[\\/]/).pop() ?? null;

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex flex-col gap-6 pb-10 px-1">

        {/* 本地备份 */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">{t("本地备份")}</Label>
          <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label className="text-sm">{t("备份数据")}</Label>
              <Button variant="outline" size="sm" className="h-8 px-3" onClick={handleExportAll}>
                <FileJson className="h-3.5 w-3.5 mr-1.5" />{t("导出 JSON 备份")}
              </Button>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label className="text-sm">{t("恢复数据")}</Label>
              <Button variant="outline" size="sm" className="h-8 px-3" onClick={handleImportFromFile}>
                <Upload className="h-3.5 w-3.5 mr-1.5" />{t("选择 JSON 文件恢复")}
              </Button>
            </div>
            {selectedFileName && (
              <div className="flex items-center justify-between px-4 py-2">
                <div className="flex-1 min-w-0 mr-3">
                  <div className="text-sm truncate">{selectedFileName}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{selectedImportFile}</div>
                </div>
                <span className="text-[10px] font-medium text-muted-foreground bg-background/80 px-1.5 py-0.5 rounded shrink-0">JSON</span>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label className="text-sm text-destructive">{t("清空所有数据")}</Label>
              <Button variant="ghost" size="sm" className="h-8 px-3 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setClearConfirmOpen(true)}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />{t("清空")}
              </Button>
            </div>
          </div>
        </div>

        {/* 操作反馈 */}
        {importMessage && (
          <div className={cn(
            "rounded-xl border px-4 py-2.5 text-sm",
            messageType === "success"
              ? "border-border/40 bg-muted/20 text-foreground"
              : "border-red-500/20 bg-red-500/8 text-red-700 dark:text-red-300"
          )}>
            {importMessage}
          </div>
        )}

        {/* Git 云端同步 */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">{t("Git 云端同步")}</Label>
          <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label className="text-sm">{t("本地仓库目录")}</Label>
              <Button variant="outline" size="sm" className="h-8 px-3" onClick={handleSelectGitRepo}>
                <FolderOpen className="h-3.5 w-3.5 mr-1.5" />{gitRepoPath ? t("更换目录") : t("选择目录")}
              </Button>
            </div>
            {gitRepoPath && (
              <div className="px-4 py-2">
                <div className="text-sm truncate text-muted-foreground" title={gitRepoPath}>{gitRepoPath}</div>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label className="text-sm">{t("推送至远端")}</Label>
              <Button size="sm" className="h-8 px-3" onClick={handleGitPush} disabled={!gitRepoPath || isSyncing}>
                <Send className="h-3.5 w-3.5 mr-1.5" />{t("推送")}
              </Button>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label className="text-sm">{t("拉取到本地")}</Label>
              <Button variant="secondary" size="sm" className="h-8 px-3 border" onClick={handleGitPull} disabled={!gitRepoPath || isSyncing}>
                <Download className="h-3.5 w-3.5 mr-1.5" />{t("拉取")}
              </Button>
            </div>
            {lastSyncTime && (
              <div className="px-4 py-2">
                <span className="text-xs text-muted-foreground">{t("最后成功同步时间：")} {new Date(lastSyncTime).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* 恢复确认弹窗 */}
      <AlertDialog open={restoreConfirmOpen} onOpenChange={(open) => { if (!open) { setRestoreConfirmOpen(false); setPendingRestoreData(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("恢复数据")}</AlertDialogTitle>
            <AlertDialogDescription>{t("恢复将覆盖当前的 SSH 配置与快捷命令，确定要继续吗？")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setRestoreConfirmOpen(false); setPendingRestoreData(null); }}>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRestore}>{t("确认恢复")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 清空确认弹窗 */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={(open) => { if (!open) setClearConfirmOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("清空所有数据")}</AlertDialogTitle>
            <AlertDialogDescription>{t("确定要清空所有会话配置和快捷命令吗？此操作不可恢复！")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setClearConfirmOpen(false)}>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onClick={handleConfirmClear}>{t("确认清空")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
