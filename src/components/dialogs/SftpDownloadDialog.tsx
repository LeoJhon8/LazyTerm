import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { CheckSquare, ChevronLeft, Download, File, Folder, Loader2, Square } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invokeTauri } from "@/services/tauri";
import { resolveSshCredential } from "@/store/credentials";
import type { SessionNode } from "@/store/ssh-profiles";
import type { SSHConfig } from "@/types/terminal";
import { useNotificationsStore } from "@/store/notifications";

interface Entry { name: string; is_dir: boolean; size: number }
interface Progress {
  file_name: string; file_size: number; file_received: number;
  overall_total: number; overall_received: number;
}
interface Props {
  open: boolean; onOpenChange: (open: boolean) => void; targetNode: SessionNode | null;
}

const joinPath = (parent: string, child: string) => `${parent.endsWith("/") ? parent : `${parent}/`}${child}`;
function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function SftpDownloadDialog({ open, onOpenChange, targetNode }: Props) {
  const addNotification = useNotificationsStore((state) => state.addNotification);
  const updateNotification = useNotificationsStore((state) => state.updateNotification);
  const [currentPath, setCurrentPath] = useState("~/");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [localDir, setLocalDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState("");
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);
  const downloadIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const config = () => {
    if (!targetNode) throw new Error("请选择 SSH 连接");
    const value = resolveSshCredential(targetNode.config as SSHConfig);
    return {
      host: value.host, port: value.port, username: value.username,
      password: value.password, private_key_path: value.privateKeyPath,
      private_key: value.privateKey, private_key_passphrase: value.privateKeyPassphrase,
    };
  };

  const fetchDir = async (path: string) => {
    if (!targetNode) return;
    setLoading(true);
    setMessage("");
    try {
      setEntries(await invokeTauri<Entry[]>("sftp_list_dir", { config: config(), path }, { scope: "FE/sftp-download/list" }));
      setCurrentPath(path);
      setSelected([]);
    } catch (error) {
      setMessage(`获取远程目录失败: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && targetNode) {
      setLocalDir(""); setReceived(0); setTotal(0); setMessage("");
      void fetchDir("~/");
    }
  }, [open, targetNode]);
  useEffect(() => () => unlistenRef.current?.(), []);

  const startDownload = async () => {
    if (!targetNode || !localDir || selected.length === 0) return;
    const downloadId = `${targetNode.id}-${Date.now()}`;
    const eventName = `sftp-download-progress-${downloadId}`;
    downloadIdRef.current = downloadId;
    setDownloading(true);
    setMessage("正在准备下载...");
    const notificationId = addNotification({
      type: "info", source: "sftp", title: "SFTP 下载中", message: targetNode.name, details: selected,
    });
    try {
      unlistenRef.current = await listen<Progress>(eventName, ({ payload }) => {
        setReceived(payload.overall_received);
        setTotal(payload.overall_total);
        updateNotification(notificationId, {
          message: `${targetNode.name} · ${formatBytes(payload.overall_received)} / ${formatBytes(payload.overall_total)}`,
          details: [`${payload.file_name} · ${formatBytes(payload.file_received)} / ${formatBytes(payload.file_size)}`],
          read: false,
        });
      });
      await invokeTauri("sftp_download", {
        config: config(), remotePaths: selected, localDir, progressEvent: eventName, downloadId,
      }, { scope: "FE/sftp-download/start" });
      setMessage("下载完成");
      updateNotification(notificationId, { type: "success", title: "下载完成", message: localDir, details: selected, read: false });
    } catch (error) {
      setMessage(`下载失败: ${String(error)}`);
      updateNotification(notificationId, { type: "error", title: "下载失败", message: targetNode.name, details: [String(error)], read: false });
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setDownloading(false);
    }
  };

  const navigateUp = () => {
    const path = currentPath.replace(/\/$/, "");
    const index = path.lastIndexOf("/");
    void fetchDir(index <= 0 ? "/" : path.slice(0, index));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Download className="h-5 w-5" />SFTP 下载 {targetNode && `- ${targetNode.name}`}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2 rounded-md bg-muted/30 p-2">
            <Button variant="ghost" size="icon" onClick={navigateUp} disabled={loading || downloading || currentPath === "/"}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-0 flex-1 truncate font-mono text-sm">{currentPath}</span>
          </div>
          <div className="h-[280px] overflow-auto rounded-md border">
            {loading ? <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> :
              entries.map((entry) => {
                const path = joinPath(currentPath, entry.name);
                const checked = selected.includes(path);
                return <div key={entry.name} className="flex items-center gap-3 border-b p-2.5 hover:bg-accent">
                  <button type="button" onClick={() => setSelected((items) => checked ? items.filter((item) => item !== path) : [...items, path])}>
                    {checked ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                  </button>
                  {entry.is_dir ? <Folder className="h-4 w-4 text-blue-500" /> : <File className="h-4 w-4 text-muted-foreground" />}
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onDoubleClick={() => entry.is_dir && void fetchDir(path)}>{entry.name}</button>
                  {!entry.is_dir && <span className="text-xs text-muted-foreground">{formatBytes(entry.size)}</span>}
                </div>;
              })}
          </div>
          <p className="text-xs text-muted-foreground">勾选文件或目录；双击目录可进入，目录会递归下载。</p>
          <div className="space-y-2">
            <Label>本地保存目录</Label>
            <div className="flex gap-2">
              <Input value={localDir} readOnly placeholder="请选择保存目录" />
              <Button variant="outline" disabled={downloading} onClick={async () => {
                const path = await openFileDialog({ directory: true, multiple: false, title: "选择下载保存目录" });
                if (typeof path === "string") setLocalDir(path);
              }}>选择</Button>
            </div>
          </div>
          {downloading && <div className="space-y-1">
            <div className="flex justify-between text-xs"><span>总体进度</span><span>{formatBytes(received)} / {formatBytes(total)}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${total ? Math.min(100, received / total * 100) : 0}%` }} /></div>
          </div>}
          {message && <div className="rounded-md bg-muted p-3 text-sm">{message}</div>}
        </div>
        <DialogFooter>
          {downloading ?
            <Button variant="destructive" onClick={() => downloadIdRef.current && invokeTauri("cancel_sftp_download", { downloadId: downloadIdRef.current })}>停止下载</Button> :
            <><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={startDownload} disabled={!targetNode || !localDir || selected.length === 0}><Download className="mr-1 h-4 w-4" />开始下载</Button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
