import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Folder, File as FileIcon, ChevronLeft, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { invokeTauri } from "@/services/tauri";
import { logger } from "@/lib/logger";
import type { SessionNode } from "@/store/ssh-profiles";
import type { SSHConfig } from "@/types/terminal";

interface SftpFileEntry {
  name: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

interface RemoteDirSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetNode: SessionNode | null;
  initialPath: string;
  onSelect: (path: string) => void;
}

export function RemoteDirSelector({ open, onOpenChange, targetNode, initialPath, onSelect }: RemoteDirSelectorProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || "~/");
  const [entries, setEntries] = useState<SftpFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDir = async (path: string) => {
    if (!targetNode?.config) return;
    setLoading(true);
    setError(null);
    try {
      const config = targetNode.config as SSHConfig;
      const result: SftpFileEntry[] = await invokeTauri(
        "sftp_list_dir",
        {
          config: {
            host: config.host,
            port: config.port,
            username: config.username,
            password: config.password,
            private_key_path: config.privateKeyPath,
          },
          path
        },
        { scope: "FE/sftp-selector/list" }
      );
      setEntries(result);
      setCurrentPath(path);
    } catch (err) {
      logger.error("FE/sftp-selector", "Failed to list directory", err);
      setError(`获取目录失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && targetNode) {
      fetchDir(initialPath || "~/");
    }
  }, [open, targetNode]);

  const handleNavigateUp = () => {
    if (currentPath === "/" || currentPath.length === 0) return;
    let parts = currentPath.replace(/\/$/, "").split("/");
    if (parts.length > 1) {
       parts.pop();
       let parent = parts.join("/") || "/";
       fetchDir(parent);
    } else {
       fetchDir("/");
    }
  };

  const handleEnterDir = (name: string) => {
    const sep = currentPath.endsWith("/") ? "" : "/";
    fetchDir(`${currentPath}${sep}${name}`);
  };

  const handleSelect = () => {
    // 自动在所选目录后加 /
    const finalPath = currentPath.endsWith("/") ? currentPath : `${currentPath}/`;
    onSelect(finalPath);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 truncate">
            选择远程目录
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 w-full min-w-0">
          <div className="flex items-center gap-2 bg-muted/30 p-2 rounded-md w-full min-w-0">
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleNavigateUp} disabled={loading || currentPath === "/"}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm flex-1 min-w-0 truncate font-mono">
              {currentPath}
            </div>
          </div>

          <div className="border rounded-md h-[300px] overflow-auto flex flex-col w-full min-w-0">
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="flex-1 flex items-center justify-center p-4 text-center text-sm text-destructive">
                {error}
              </div>
            ) : entries.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                没有文件或目录
              </div>
            ) : (
              <div className="divide-y w-full min-w-0">
                {entries.map((entry) => (
                  <div
                    key={entry.name}
                    className={cn(
                      "flex items-center gap-3 p-2.5 text-sm transition-colors hover:bg-accent cursor-pointer select-none w-full min-w-0",
                      !entry.is_dir && "opacity-60 cursor-default"
                    )}
                    onDoubleClick={() => {
                        if (entry.is_dir) handleEnterDir(entry.name);
                    }}
                  >
                    {entry.is_dir ? <Folder className="h-4 w-4 text-blue-500 fill-blue-500/20 shrink-0" /> : <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <span className="flex-1 min-w-0 truncate">{entry.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            双击文件夹进入目录
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSelect} disabled={loading}>
            <Check className="h-4 w-4 mr-1" />
            选择当前目录
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
