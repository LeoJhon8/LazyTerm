import { useState, useRef, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { File, X, Upload, Folder, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { size as getFileSize } from "@tauri-apps/plugin-fs";
import { invokeTauri } from "@/services/tauri";
import { logger } from "@/lib/logger";
import type { SessionNode } from "@/store/ssh-profiles";
import type { SSHConfig } from "@/types/terminal";

interface SftpLocalFile {
  path: string;
  name: string;
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

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / Math.pow(1024, index);
  return `${size.toFixed(size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2)} ${units[index]}`;
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

export function SftpUploadDialog({ open, onOpenChange, targetNode }: SftpUploadDialogProps) {
  const [remotePath, setRemotePath] = useState("");
  const [files, setFiles] = useState<SftpLocalFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [overallSent, setOverallSent] = useState(0);
  const [overallTotal, setOverallTotal] = useState(0);
  const [fileProgress, setFileProgress] = useState<Record<string, { sent: number; total: number }>>({});
  
  const progressUnlistenRef = useRef<UnlistenFn | null>(null);
  const currentUploadIdRef = useRef<string | null>(null);

  const selectedTotal = useMemo(() => files.reduce((acc, item) => acc + (item.size || 0), 0), [files]);

  // 清理监听器
  useEffect(() => {
    return () => {
      if (progressUnlistenRef.current) {
        progressUnlistenRef.current();
        progressUnlistenRef.current = null;
      }
      currentUploadIdRef.current = null;
    };
  }, []);

  // 重置状态当对话框打开时
  useEffect(() => {
    if (open) {
      setFiles([]);
      setRemotePath("");
      setMessage(null);
      setOverallSent(0);
      setOverallTotal(0);
      setFileProgress({});
      setUploading(false);
      setStopping(false);
    }
  }, [open]);

  const handleSelectFiles = async () => {
    try {
      const selected = await openFileDialog({
        multiple: true,
        title: "选择要上传的文件",
      });
      
      if (!selected || (Array.isArray(selected) && selected.length === 0)) {
        return;
      }

      const paths = Array.isArray(selected) ? selected : [selected];
      const fileList: SftpLocalFile[] = [];

      for (const path of paths) {
        try {
          const size = await getFileSize(path);
          fileList.push({
            path,
            name: getFileName(path),
            size: Number(size),
          });
        } catch (e) {
          logger.warn("FE/sftp-dialog", "无法获取文件信息", { path, error: e });
        }
      }

      setFiles(fileList);
      setMessage({ text: `已选择 ${fileList.length} 个文件`, type: "info" });
    } catch (error) {
      logger.error("FE/sftp-dialog", "选择文件失败", error);
      setMessage({ text: "选择文件失败", type: "error" });
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const resolveRemotePath = (basePath: string, fileName: string, isBatch: boolean) => {
    const trimmed = basePath.trim();
    if (!trimmed) return "";
    
    if (isBatch) {
      // 批量上传时，使用基础路径作为目录
      const dir = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
      return `${dir}${fileName}`;
    }
    
    // 单文件上传
    if (trimmed.endsWith("/")) {
      return `${trimmed}${fileName}`;
    }
    return trimmed;
  };

  const handleUpload = async () => {
    if (!targetNode || files.length === 0) return;

    const config = targetNode.config as SSHConfig;
    const uploadId = `${targetNode.id}-${Date.now()}`;
    currentUploadIdRef.current = uploadId;

    try {
      setUploading(true);
      setMessage({ text: "正在准备上传...", type: "info" });
      setOverallSent(0);
      setOverallTotal(selectedTotal);
      setFileProgress({});

      // 设置进度监听
      const eventName = `sftp-upload-progress-${uploadId}`;
      progressUnlistenRef.current = await listen<SftpUploadProgressPayload>(eventName, (event) => {
        const payload = event.payload;
        setOverallSent(payload.overall_sent);
        setOverallTotal(payload.overall_total);
        setFileProgress((prev) => ({
          ...prev,
          [payload.local_path]: {
            sent: payload.file_sent,
            total: payload.file_size,
          },
        }));
      });

      const items = files.map((file) => ({
        local_path: file.path,
        remote_path: resolveRemotePath(remotePath, file.name, files.length > 1),
      }));

      await invokeTauri(
        "sftp_upload_files",
        {
          config: {
            host: config.host,
            port: config.port,
            username: config.username,
            password: config.password,
            private_key_path: config.privateKeyPath,
          },
          items,
          upload_id: uploadId,
        },
        { scope: "FE/sftp-dialog/upload" }
      );

      setMessage({ text: "上传完成", type: "success" });
      setTimeout(() => {
        onOpenChange(false);
      }, 1000);
    } catch (error) {
      logger.error("FE/sftp-dialog", "上传失败", error);
      setMessage({ text: `上传失败: ${error}`, type: "error" });
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
        { upload_id: currentUploadIdRef.current },
        { scope: "FE/sftp-dialog/cancel" }
      );
      setMessage({ text: "已取消上传", type: "info" });
    } catch (error) {
      logger.error("FE/sftp-dialog", "取消上传失败", error);
    } finally {
      setStopping(false);
      setUploading(false);
    }
  };

  const isSshNode = targetNode?.type === "ssh";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            SFTP 文件上传
            {targetNode && (
              <span className="text-sm font-normal text-muted-foreground">
                - {targetNode.name}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!isSshNode ? (
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-3 rounded-md">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">请选择一个 SSH 连接节点进行上传</span>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="remote-path">远程路径</Label>
                <Input
                  id="remote-path"
                  placeholder="例如: /home/user/uploads/ 或 /home/user/file.txt"
                  value={remotePath}
                  onChange={(e) => setRemotePath(e.target.value)}
                  disabled={uploading}
                />
                <p className="text-xs text-muted-foreground">
                  批量上传时，此路径作为目标目录；单文件上传时，可指定完整文件路径
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>本地文件</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectFiles}
                    disabled={uploading}
                  >
                    <Folder className="h-4 w-4 mr-1" />
                    选择文件
                  </Button>
                </div>

                {files.length > 0 ? (
                  <div className="border rounded-md divide-y max-h-[200px] overflow-auto">
                    {files.map((file, index) => {
                      const progress = fileProgress[file.path];
                      const isUploading = !!progress;
                      
                      return (
                        <div key={file.path} className="p-3 flex items-center gap-3">
                          <File className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{file.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatBytes(file.size)}
                            </p>
                            {isUploading && (
                              <div className="mt-2">
                                <Progress
                                  value={(progress.sent / progress.total) * 100}
                                  className="h-1"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                  {formatBytes(progress.sent)} / {formatBytes(progress.total)}
                                </p>
                              </div>
                            )}
                          </div>
                          {!uploading && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeFile(index)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="border rounded-md p-8 text-center text-muted-foreground">
                    <Upload className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">点击"选择文件"添加要上传的文件</p>
                  </div>
                )}

                {files.length > 0 && (
                  <p className="text-xs text-muted-foreground text-right">
                    共 {files.length} 个文件，总计 {formatBytes(selectedTotal)}
                  </p>
                )}
              </div>

              {uploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>总体进度</span>
                    <span>{formatBytes(overallSent)} / {formatBytes(overallTotal)}</span>
                  </div>
                  <Progress value={overallTotal > 0 ? (overallSent / overallTotal) * 100 : 0} />
                </div>
              )}

              {message && (
                <div
                  className={cn(
                    "p-3 rounded-md text-sm",
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
              {stopping ? "停止中..." : "停止上传"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!isSshNode || files.length === 0 || !remotePath.trim()}
              >
                <Upload className="h-4 w-4 mr-1" />
                开始上传
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
