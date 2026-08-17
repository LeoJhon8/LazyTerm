import { useState, useRef, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { File, X, Upload, FolderOpen, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { downloadDir } from "@tauri-apps/api/path";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { readDir, stat } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invokeTauri } from "@/services/tauri";
import { logger } from "@/lib/logger";
import { RemoteDirSelector } from "./RemoteDirSelector";
import type { SessionNode } from "@/store/ssh-profiles";
import type { SSHConfig } from "@/types/terminal";
import { resolveSshCredential } from "@/store/credentials";
import { useSettingsStore } from "@/store/settings";
import { useI18n } from "@/i18n";
import { useNotificationsStore } from "@/store/notifications";

interface SftpLocalFile {
  path: string;
  name: string;
  size: number;
  relativePath: string;
  isDirectory?: boolean;
  sourcePath: string;
  sourceType: "file" | "directory";
}

interface SftpSelectionRoot {
  path: string;
  name: string;
  type: "file" | "directory";
  size: number;
}

interface SftpUploadProgressPayload {
  file_index: number;
  file_name: string;
  local_path: string;
  file_size: number;
  file_sent: number;
  overall_total: number;
  overall_sent: number;
}

interface SftpUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetNode: SessionNode | null;
}

function getFileName(path: string) {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

const DEFAULT_REMOTE_PATH = "~/";

async function getDefaultLocalSelectionPath() {
  try {
    return await downloadDir();
  } catch (error) {
    logger.warn("FE/sftp-dialog", "无法获取用户下载目录", error);
    return undefined;
  }
}

function joinLocalPath(parent: string, child: string) {
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[/\\]$/, "")}${separator}${child}`;
}

function joinRelativePath(parent: string, child: string) {
  return parent ? `${parent}/${child}` : child;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / Math.pow(1024, index);
  return `${size.toFixed(size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2)} ${units[index]}`;
}

function buildUploadNotificationDetails(remotePaths: string[], currentFile?: string) {
  const maxPathDetails = 20;
  const details = currentFile ? [currentFile] : [];
  details.push(...remotePaths.slice(0, maxPathDetails));

  if (remotePaths.length > maxPathDetails) {
    details.push(`还有 ${remotePaths.length - maxPathDetails} 个目标路径未展开显示`);
  }

  return details;
}

// 简单的进度条组件
function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 w-full rounded-full bg-muted overflow-hidden", className)}>
      <div
        className="h-full bg-primary transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

interface UploadSelectionAreaProps {
  type: "file" | "directory";
  roots: SftpSelectionRoot[];
  title: string;
  hint: string;
  emptyText: string;
  disabled: boolean;
  onSelect: () => void;
  onRemove: (path: string) => void;
}

function UploadSelectionArea({
  type,
  roots,
  title,
  hint,
  emptyText,
  disabled,
  onSelect,
  onRemove,
}: UploadSelectionAreaProps) {
  const Icon = type === "file" ? File : FolderOpen;

  return (
    <div
      role="button"
      tabIndex={disabled ? undefined : 0}
      aria-label={title}
      className={cn(
        "flex h-[190px] min-w-0 flex-col overflow-hidden rounded-md border border-border/50 bg-muted/15 transition-colors",
        disabled ? "cursor-default opacity-60" : "cursor-pointer hover:border-primary/50 hover:bg-accent/20"
      )}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      onKeyDown={(event) => {
        if (disabled || event.currentTarget !== event.target) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {roots.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center p-3 text-center">
          <Icon className="mb-2 h-7 w-7 text-primary" />
          <span className="text-sm font-medium">{title}</span>
          <span className="mt-1 text-xs text-muted-foreground">{hint}</span>
          <span className="mt-3 text-[11px] text-muted-foreground/70">{emptyText}</span>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <Icon className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{hint}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
          <div className="divide-y">
            {roots.map((root) => (
              <div key={root.path} className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs" title={root.path}>{root.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(root.size)}</span>
                {!disabled && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(root.path);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          </div>
        </>
      )}
    </div>
  );
}

export function SftpUploadDialog({ open, onOpenChange, targetNode }: SftpUploadDialogProps) {
  const { t } = useI18n();
  const addNotification = useNotificationsStore((state) => state.addNotification);
  const updateNotification = useNotificationsStore((state) => state.updateNotification);
  const [remotePath, setRemotePath] = useState(DEFAULT_REMOTE_PATH);
  const [files, setFiles] = useState<SftpLocalFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [overallSent, setOverallSent] = useState(0);
  const [overallTotal, setOverallTotal] = useState(0);
  const [showDirSelector, setShowDirSelector] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  
  const progressUnlistenRef = useRef<UnlistenFn | null>(null);
  const currentUploadIdRef = useRef<string | null>(null);
  const progressNotificationIdRef = useRef<string | null>(null);
  const lastNotificationProgressRef = useRef(0);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const selectedTotal = useMemo(() => files.reduce((acc, item) => acc + (item.size || 0), 0), [files]);
  const selectionRoots = useMemo(() => {
    const roots = new Map<string, SftpSelectionRoot>();

    files.forEach((file) => {
      const existing = roots.get(file.sourcePath);
      if (existing) {
        existing.size += file.size || 0;
        return;
      }
      roots.set(file.sourcePath, {
        path: file.sourcePath,
        name: getFileName(file.sourcePath),
        type: file.sourceType,
        size: file.size || 0,
      });
    });

    return [...roots.values()];
  }, [files]);
  const selectedFileRoots = selectionRoots.filter((root) => root.type === "file");
  const selectedDirectoryRoots = selectionRoots.filter((root) => root.type === "directory");

  // 清理监听器
  useEffect(() => {
    return () => {
      if (progressUnlistenRef.current) {
        progressUnlistenRef.current();
        progressUnlistenRef.current = null;
      }
      currentUploadIdRef.current = null;
      progressNotificationIdRef.current = null;
    };
  }, []);

  // 重置状态当对话框打开时
  useEffect(() => {
    if (open) {
      setFiles([]);
      setRemotePath(DEFAULT_REMOTE_PATH);
      setMessage(null);
      setOverallSent(0);
      setOverallTotal(0);
      setUploading(false);
      setStopping(false);
      setIsDragOver(false);
      progressNotificationIdRef.current = null;
      lastNotificationProgressRef.current = 0;
    }
  }, [open]);

  const collectFilesFromPath = async (
    path: string,
    relativePath?: string,
    source?: Pick<SftpLocalFile, "sourcePath" | "sourceType">
  ): Promise<SftpLocalFile[]> => {
    const fileInfo = await stat(path);
    const name = getFileName(path);
    const rootSource = source ?? {
      sourcePath: path,
      sourceType: fileInfo.isDirectory ? "directory" as const : "file" as const,
    };

    if (fileInfo.isFile) {
      return [{
        path,
        name,
        size: Number(fileInfo.size),
        relativePath: relativePath ?? name,
        ...rootSource,
      }];
    }

    if (!fileInfo.isDirectory) {
      return [];
    }

    const rootRelativePath = relativePath ?? name;
    const entries = await readDir(path);
    const nestedFiles: SftpLocalFile[] = [{
      path,
      name,
      size: 0,
      relativePath: rootRelativePath,
      isDirectory: true,
      ...rootSource,
    }];

    for (const entry of entries) {
      if (entry.isSymlink) continue;

      const childPath = joinLocalPath(path, entry.name);
      const childRelativePath = joinRelativePath(rootRelativePath, entry.name);

      if (entry.isDirectory) {
        nestedFiles.push(...await collectFilesFromPath(childPath, childRelativePath, rootSource));
      } else if (entry.isFile) {
        const childInfo = await stat(childPath);
        nestedFiles.push({
          path: childPath,
          name: entry.name,
          size: Number(childInfo.size),
          relativePath: childRelativePath,
          ...rootSource,
        });
      }
    }

    return nestedFiles;
  };

  const addFilesFromPaths = async (paths: string[]) => {
    const fileList: SftpLocalFile[] = [];

    for (const path of paths) {
      try {
        fileList.push(...await collectFilesFromPath(path));
      } catch (e) {
        logger.warn("FE/sftp-dialog", "无法获取文件信息", { path, error: e });
      }
    }

    setFiles((prev) => {
      const existing = new Set(prev.map((file) => `${file.sourcePath}\0${file.path}`));
      const toAdd = fileList.filter((file) => {
        const key = `${file.sourcePath}\0${file.path}`;
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
      });
      const next = [...prev, ...toAdd];
      if (toAdd.length > 0) {
        const rootCount = new Set(toAdd.map((file) => file.sourcePath)).size;
        setMessage({ text: t("已添加 {count} 项", { count: rootCount }), type: "info" });
      }
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    
    let unlistenFn: UnlistenFn | null = null;
    let isSubscribed = true;

    const setupDragDrop = async () => {
      try {
        const currentWindow = getCurrentWindow();
        const scaleFactor = await currentWindow.scaleFactor();
        const isInsideDropZone = (position: { x: number; y: number }) => {
          const element = dropZoneRef.current;
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const x = position.x / scaleFactor;
          const y = position.y / scaleFactor;
          return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        };

        unlistenFn = await currentWindow.onDragDropEvent((event) => {
          if (!isSubscribed) return;

          if (event.payload.type === "enter" || event.payload.type === "over") {
            setIsDragOver(isInsideDropZone(event.payload.position));
          } else if (event.payload.type === 'leave') {
            setIsDragOver(false);
          } else if (event.payload.type === 'drop') {
            const shouldAdd = isInsideDropZone(event.payload.position);
            setIsDragOver(false);
            if (shouldAdd && event.payload.paths.length > 0) {
              void addFilesFromPaths(event.payload.paths);
            }
          }
        });
      } catch (err) {
        logger.warn("FE/sftp-dialog", "无法绑定拖拽事件", err);
      }
    };

    setupDragDrop();

    return () => {
      isSubscribed = false;
      if (unlistenFn) unlistenFn();
    };
  }, [open]);

  const handleSelectFiles = async () => {
    try {
      const defaultPath = await getDefaultLocalSelectionPath();
      const selected = await openFileDialog({
        multiple: true,
        title: t("选择要上传的文件"),
        defaultPath,
      });

      if (!selected || (Array.isArray(selected) && selected.length === 0)) return;
      await addFilesFromPaths(Array.isArray(selected) ? selected : [selected]);
    } catch (error) {
      logger.error("FE/sftp-dialog", "选择文件失败", error);
      setMessage({ text: t("选择文件失败"), type: "error" });
    }
  };

  const handleSelectDirectories = async () => {
    try {
      const defaultPath = await getDefaultLocalSelectionPath();
      const selected = await openFileDialog({
        directory: true,
        multiple: true,
        recursive: true,
        title: t("选择要上传的目录"),
        defaultPath,
      });

      if (!selected || (Array.isArray(selected) && selected.length === 0)) return;
      await addFilesFromPaths(Array.isArray(selected) ? selected : [selected]);
    } catch (error) {
      logger.error("FE/sftp-dialog", "选择目录失败", error);
      setMessage({ text: t("选择目录失败"), type: "error" });
    }
  };

  const removeSelectionRoot = (sourcePath: string) => {
    setFiles((prev) => prev.filter((file) => file.sourcePath !== sourcePath));
  };

  const resolveRemotePath = (basePath: string, relativePath: string) => {
    let trimmed = basePath.trim();
    if (!trimmed) trimmed = "/"; // 默认根目录
    
    const dir = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    const normalizedRelativePath = relativePath
      .split(/[/\\]/)
      .filter(Boolean)
      .join("/");
    return `${dir}${normalizedRelativePath}`;
  };

  const formatUploadProgressMessage = (sent: number, total: number) => {
    const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((sent / total) * 100))) : 0;
    return `${percent}% · ${formatBytes(sent)} / ${formatBytes(total)}`;
  };

  const handleUpload = async () => {
    if (!targetNode || files.length === 0 || !remotePath.trim()) return;

      const config = resolveSshCredential(targetNode.config as SSHConfig);
    const uploadId = `${targetNode.id}-${Date.now()}`;
    currentUploadIdRef.current = uploadId;

    try {
      setUploading(true);
      setMessage({ text: t("正在准备上传..."), type: "info" });
      setOverallSent(0);
      setOverallTotal(selectedTotal);

      const items = files.map((file) => ({
        local_path: file.path,
        remote_path: resolveRemotePath(remotePath, file.relativePath),
        is_dir: file.isDirectory ?? false,
      }));
      const remotePaths = items.map((item) => item.remote_path);

      progressNotificationIdRef.current = addNotification({
        type: "info",
        source: "sftp",
        title: "SFTP 上传中",
        message: `${targetNode.name} · ${formatUploadProgressMessage(0, selectedTotal)}`,
        details: buildUploadNotificationDetails(remotePaths),
      });
      lastNotificationProgressRef.current = 0;

      // 设置进度监听
      const eventName = `sftp-upload-progress-${uploadId}`;
      progressUnlistenRef.current = await listen<SftpUploadProgressPayload>(eventName, (event) => {
        const payload = event.payload;
        setOverallSent(payload.overall_sent);
        setOverallTotal(payload.overall_total);
        const now = Date.now();
        const isComplete = payload.overall_total > 0 && payload.overall_sent >= payload.overall_total;
        if (
          progressNotificationIdRef.current &&
          (isComplete || now - lastNotificationProgressRef.current >= 500)
        ) {
          lastNotificationProgressRef.current = now;
          updateNotification(progressNotificationIdRef.current, {
            type: "info",
            title: "SFTP 上传中",
            message: `${targetNode.name} · ${formatUploadProgressMessage(payload.overall_sent, payload.overall_total)}`,
            details: buildUploadNotificationDetails(
              remotePaths,
              `${payload.file_name} · ${formatBytes(payload.file_sent)} / ${formatBytes(payload.file_size)}`,
            ),
            read: false,
          });
        }
      });

      await invokeTauri(
        "sftp_upload_files",
        {
          config: {
            host: config.host,
            port: config.port,
            username: config.username,
            password: config.password,
            private_key_path: config.privateKeyPath,
            auto_update_changed_host_keys: useSettingsStore.getState().autoUpdateChangedSshHostKeys,
          },
          files: items,
          progressEvent: eventName,
          uploadId: uploadId,
        },
        { scope: "FE/sftp-dialog/upload" }
      );

      setMessage({ text: t("上传完成"), type: "success" });
      if (progressNotificationIdRef.current) {
        updateNotification(progressNotificationIdRef.current, {
          type: "success",
          title: t("上传完成"),
          message: `${targetNode.name} · ${formatUploadProgressMessage(selectedTotal, selectedTotal)}`,
          details: buildUploadNotificationDetails(remotePaths),
          read: false,
        });
      }
      setTimeout(() => {
        onOpenChange(false);
      }, 1000);
    } catch (error) {
      logger.error("FE/sftp-dialog", "上传失败", error);
      const errorMessage = t("上传失败: {error}", { error: String(error) });
      setMessage({ text: errorMessage, type: "error" });
      if (progressNotificationIdRef.current) {
        updateNotification(progressNotificationIdRef.current, {
          type: "error",
          title: errorMessage,
          message: targetNode.name,
          details: [String(error)],
          read: false,
        });
      } else {
        addNotification({
          type: "error",
          source: "sftp",
          title: errorMessage,
          message: targetNode.name,
          details: [String(error)],
        });
      }
    } finally {
      setUploading(false);
      if (progressUnlistenRef.current) {
        progressUnlistenRef.current();
        progressUnlistenRef.current = null;
      }
    }
  };

  const handleStop = async () => {
    if (!currentUploadIdRef.current) return;
    
    try {
      setStopping(true);
      await invokeTauri(
        "cancel_sftp_upload",
        { uploadId: currentUploadIdRef.current },
        { scope: "FE/sftp-dialog/cancel" }
      );
      setMessage({ text: t("已取消上传"), type: "info" });
      if (progressNotificationIdRef.current) {
        updateNotification(progressNotificationIdRef.current, {
          type: "warning",
          title: t("已取消上传"),
          message: targetNode?.name,
          read: false,
        });
      } else {
        addNotification({
          type: "warning",
          source: "sftp",
          title: t("已取消上传"),
          message: targetNode?.name,
        });
      }
    } catch (error) {
      logger.error("FE/sftp-dialog", "取消上传失败", error);
    } finally {
      setStopping(false);
      setUploading(false);
    }
  };

  const isSshNode = targetNode?.type === "ssh";
  const hasRemotePath = remotePath.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] min-w-0 overflow-x-hidden overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <Upload className="h-5 w-5 shrink-0" />
            {t("SFTP 文件上传")}
            {targetNode && (
              <span className="min-w-0 truncate text-sm font-normal text-muted-foreground">
                - {targetNode.name}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4 py-4">
          {!isSshNode ? (
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-3 rounded-md">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{t("请选择一个 SSH 连接节点进行上传")}</span>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="remote-path">{t("远程路径")}</Label>
                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    id="remote-path"
                    placeholder={t("请输入远程路径")}
                    value={remotePath}
                    onChange={(e) => setRemotePath(e.target.value)}
                    disabled={uploading}
                    className="min-w-0 flex-1 w-auto"
                  />
                  <Button
                    variant="outline"
                    onClick={() => setShowDirSelector(true)}
                    disabled={uploading}
                  >
                    {t("选择")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("此路径将作为目标目录进行上传")}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t("本地文件或目录")}</Label>
                <div
                  ref={dropZoneRef}
                  className={cn(
                    "relative min-w-0 overflow-hidden rounded-md border p-2 transition-colors",
                    isDragOver && "border-primary bg-accent/30"
                  )}
                >
                  <div className="grid grid-cols-[minmax(0,7fr)_minmax(120px,3fr)] gap-2">
                    <UploadSelectionArea
                      type="file"
                      roots={selectedFileRoots}
                      title={t("点击上传文件")}
                      hint={t("支持多选")}
                      emptyText={t("暂无文件")}
                      disabled={uploading}
                      onSelect={() => void handleSelectFiles()}
                      onRemove={removeSelectionRoot}
                    />
                    <UploadSelectionArea
                      type="directory"
                      roots={selectedDirectoryRoots}
                      title={t("点击上传目录")}
                      hint={t("支持多选")}
                      emptyText={t("暂无目录")}
                      disabled={uploading}
                      onSelect={() => void handleSelectDirectories()}
                      onRemove={removeSelectionRoot}
                    />
                  </div>

                  {isDragOver && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-background/85 backdrop-blur-sm">
                      <p className="text-sm font-medium text-primary">{t("松开鼠标添加文件或目录")}</p>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t("拖拽文件和目录到此区域，将自动识别")}</p>

                {selectionRoots.length > 0 && (
                  <p className="text-xs text-muted-foreground text-right">
                    {t("共 {count} 项，总计 {size}", { count: selectionRoots.length, size: formatBytes(selectedTotal) })}
                  </p>
                )}
              </div>

              {uploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>{t("总体进度")}</span>
                    <span>{formatBytes(overallSent)} / {formatBytes(overallTotal)}</span>
                  </div>
                  <Progress value={overallTotal > 0 ? (overallSent / overallTotal) * 100 : 0} />
                </div>
              )}

              {message && (
                <div
                  className={cn(
                    "min-w-0 break-words p-3 rounded-md text-sm",
                    message.type === "success" && "bg-green-50 text-green-700",
                    message.type === "error" && "bg-red-50 text-red-700",
                    message.type === "info" && "bg-blue-50 text-blue-700"
                  )}
                >
                  {message.text}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          {uploading ? (
            <Button variant="destructive" onClick={handleStop} disabled={stopping}>
              {stopping ? t("停止中...") : t("停止上传")}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("取消")}
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!isSshNode || files.length === 0 || !hasRemotePath}
              >
                <Upload className="h-4 w-4 mr-1" />
                {t("开始上传")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <RemoteDirSelector
        open={showDirSelector}
        onOpenChange={setShowDirSelector}
        targetNode={targetNode}
        initialPath={remotePath}
        onSelect={(path) => setRemotePath(path)}
      />
    </Dialog>
  );
}
