import React, { useState, useMemo, useEffect, useRef } from "react";
import { 
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay, 
  useDraggable, useDroppable
} from "@dnd-kit/core";
import { 
  Folder, Server, ChevronRight, ChevronDown, Plus, FolderPlus, 
  Pencil, Trash2, Terminal, Upload, File, X
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSshProfilesStore, type SessionNode } from "@/store/ssh-profiles";
import { useTabsStore } from "@/store/tabs";
import { SshConnectDialog } from "@/components/dialogs/SshConnectDialog";
import { 
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator 
} from "@/components/ui/context-menu";
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel 
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Terminal as TerminalIcon, ShieldAlert, MonitorCheck, PlusCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { stat, size as getFileSize } from "@tauri-apps/plugin-fs";

interface AvailableShell {
  name: string;
  path: string;
  icon_type: string;
}

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

type DropPosition = 'before' | 'after' | 'inside';

function getSortedFlattenedNodes(nodes: SessionNode[], parentId: string | null = null, depth = 0): (SessionNode & { depth: number })[] {
  return nodes
    .filter(n => n.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .reduce((acc, node) => {
      acc.push({ ...node, depth });
      if (node.type === 'folder' && node.isExpanded) {
        acc.push(...getSortedFlattenedNodes(nodes, node.id, depth + 1));
      }
      return acc;
    }, [] as (SessionNode & { depth: number })[]);
}

function getDropPosition(
  node: SessionNode,
  activeRect: { top: number; height: number } | null | undefined,
  overRect: { top: number; height: number } | null | undefined,
): DropPosition | null {
  if (!activeRect || !overRect) return null;

  if (node.isRoot) {
    return 'inside';
  }

  const activeCenterY = activeRect.top + activeRect.height / 2;
  const relativeY = activeCenterY - overRect.top;

  if (node.type === 'folder') {
    if (relativeY < overRect.height * 0.25) return 'before';
    if (relativeY > overRect.height * 0.75) return 'after';
    return 'inside';
  }

  return relativeY < overRect.height * 0.5 ? 'before' : 'after';
}

function NodeRowContent({ 
  node, depth, isDragging, isOver, dropPos, isOverlay 
}: { 
  node: SessionNode, depth: number, isDragging?: boolean, isOver?: boolean, dropPos?: DropPosition | null, isOverlay?: boolean 
}) {
  const isFolder = node.type === "folder";
  return (
    <div
      style={{ paddingLeft: `${isOverlay ? 8 : depth * 14 + 6}px` }}
      className={cn(
        "flex items-center gap-2 py-1.5 px-2 rounded-sm text-sm transition-all relative border-y border-transparent",
        !isOverlay && "group hover:bg-accent/40",
        isOverlay && "bg-background border shadow-xl opacity-90 w-[240px] z-50 pointer-events-none",
        
        // 放置指示器
        isOver && !isDragging && dropPos === 'before' && [
          "before:content-[''] before:absolute before:top-[-1px] before:left-0 before:right-0 before:h-[2px] before:bg-primary before:z-[100]"
        ],
        isOver && !isDragging && dropPos === 'after' && [
          "after:content-[''] after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-[2px] after:bg-primary after:z-[100]"
        ],
        isOver && !isDragging && dropPos === 'inside' && "bg-primary/20 ring-1 ring-primary/30 ring-inset"
      )}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isFolder ? (
          <div className="flex items-center gap-1 text-muted-foreground/60">
            {node.isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Folder className={cn("h-4 w-4", node.isRoot ? "text-amber-500 fill-amber-500/10" : "text-blue-500 fill-blue-500/10")} />
          </div>
        ) : (
          <Server className="h-4 w-4 text-emerald-600/80" />
        )}
        <span
          title={node.name}
          className={cn("truncate flex-1 select-none", node.isRoot ? "font-bold text-foreground" : "font-medium text-muted-foreground group-hover:text-foreground")}
        >
          {node.name}
        </span>
      </div>
    </div>
  );
}

function DraggableDroppableRow({
  node,
  depth,
  onAction,
  overId,
  dropPos,
}: {
  node: SessionNode;
  depth: number;
  onAction: (type: string, node: SessionNode) => void;
  overId: string | null;
  dropPos: DropPosition | null;
}) {
  const { toggleFolder } = useSshProfilesStore();

  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({ 
    id: node.id, 
    disabled: node.isRoot 
  });
  
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ 
    id: node.id,
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div 
          ref={setDroppableRef} 
          onClick={() => node.type === 'folder' && toggleFolder(node.id)}
          onDoubleClick={() => node.type !== 'folder' && onAction('connect', node)}
        >
          <div ref={setDraggableRef} {...attributes} {...listeners} className={cn(isDragging && "opacity-20")}>
            <NodeRowContent 
              node={node} 
              depth={depth} 
              isDragging={isDragging} 
              isOver={isOver && overId === node.id} 
              dropPos={overId === node.id ? dropPos : null} 
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {node.type === 'folder' ? (
          <>
            <ContextMenuItem onClick={() => onAction('new-ssh', node)}><Plus className="mr-2 h-4 w-4" /> 新建连接</ContextMenuItem>
            <ContextMenuItem onClick={() => onAction('new-folder', node)}><FolderPlus className="mr-2 h-4 w-4" /> 新建子文件夹</ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={() => onAction('connect', node)}><Terminal className="mr-2 h-4 w-4" /> 连接会话</ContextMenuItem>
            <ContextMenuItem onClick={() => onAction('sftp-upload', node)}><Upload className="mr-2 h-4 w-4" /> SFTP 上传文件</ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onAction('edit', node)}><Pencil className="mr-2 h-4 w-4" /> 编辑</ContextMenuItem>
        {!node.isRoot && <ContextMenuItem onClick={() => onAction('delete', node)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> 删除</ContextMenuItem>}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function SessionModule() {
  const { nodes, addFolder, addProfile, removeNode, updateNode, moveNode, ensureRoot } = useSshProfilesStore();
  const { addSession } = useTabsStore();

  const [dragState, setDragState] = useState<{
    activeId: string | null;
    overId: string | null;
    dropPos: DropPosition | null;
  }>({ activeId: null, overId: null, dropPos: null });
  const [sshOpen, setSshOpen] = useState(false);
  const [directSshOpen, setDirectSshOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [targetNode, setTargetNode] = useState<SessionNode | null>(null);
  const [editNode, setEditNode] = useState<SessionNode | null>(null);
  const [tempName, setTempName] = useState("");
  const [availableShells, setAvailableShells] = useState<AvailableShell[]>([]);
  const [sftpOpen, setSftpOpen] = useState(false);
  const [sftpRemotePath, setSftpRemotePath] = useState("");
  const [sftpUploading, setSftpUploading] = useState(false);
  const [sftpMessage, setSftpMessage] = useState<string | null>(null);
  const [sftpMessageType, setSftpMessageType] = useState<"success" | "error">("success");
  const [sftpTargetNode, setSftpTargetNode] = useState<SessionNode | null>(null);
  const [sftpFiles, setSftpFiles] = useState<SftpLocalFile[]>([]);
  const [sftpOverallSent, setSftpOverallSent] = useState(0);
  const [sftpOverallTotal, setSftpOverallTotal] = useState(0);
  const [sftpFileProgress, setSftpFileProgress] = useState<Record<string, { sent: number; total: number }>>({});
  const progressUnlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => { 
    ensureRoot(); 
    // 鑾峰彇绯荤粺鍙敤 Shell
    invoke<AvailableShell[]>("get_available_shells")
      .then(setAvailableShells)
      .catch(err => console.error("获取可用 Shell 失败:", err));
  }, [ensureRoot]);

  useEffect(() => {
    return () => {
      if (progressUnlistenRef.current) {
        progressUnlistenRef.current();
        progressUnlistenRef.current = null;
      }
    };
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const sortedNodes = useMemo(() => getSortedFlattenedNodes(nodes), [nodes]);
  const sftpSelectedTotal = useMemo(() => sftpFiles.reduce((acc, item) => acc + (item.size || 0), 0), [sftpFiles]);

  const activeDragNode = useMemo(
    () => (dragState.activeId ? nodes.find((node) => node.id === dragState.activeId) ?? null : null),
    [dragState.activeId, nodes]
  );

  const updateDragState = (
    activeId: string | null,
    overId: string | null,
    dropPos: DropPosition | null,
  ) => {
    setDragState((prev) => {
      if (prev.activeId === activeId && prev.overId === overId && prev.dropPos === dropPos) {
        return prev;
      }
      return { activeId, overId, dropPos };
    });
  };

  const getFileName = (path: string) => {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  };

  const formatBytes = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const size = value / Math.pow(1024, index);
    return `${size.toFixed(size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2)} ${units[index]}`;
  };

  const resolveRemotePath = (basePath: string, fileName: string, isBatch: boolean) => {
    const trimmed = basePath.trim();
    if (!trimmed) return "";
    if (!isBatch && !trimmed.endsWith("/")) return trimmed;
    const normalized = trimmed === "~" ? "~/" : trimmed;
    const separator = normalized.endsWith("/") ? "" : "/";
    return `${normalized}${separator}${fileName}`;
  };

  const loadLocalFiles = async (paths: string[]) => {
    const items = await Promise.all(paths.map(async (path) => {
      const name = getFileName(path);
      let size = 0;
      try {
        const info = await stat(path);
        const rawSize = (info as { size?: number | bigint | string; len?: number | bigint | string }).size
          ?? (info as { len?: number | bigint | string }).len
          ?? 0;
        const sizeNumber = typeof rawSize === "bigint" ? Number(rawSize) : Number(rawSize);
        size = Number.isFinite(sizeNumber) ? sizeNumber : 0;
        if (size === 0) {
          const actualSize = await getFileSize(path);
          const actualNumber = typeof actualSize === "bigint" ? Number(actualSize) : Number(actualSize);
          size = Number.isFinite(actualNumber) ? actualNumber : 0;
        }
      } catch (err) {
        console.error("获取文件信息失败:", err);
      }
      return { path, name, size };
    }));
    return items;
  };

  const handleSftpPickFiles = async (node: SessionNode, append = false) => {
    if (!node.config) return;
    try {
      const selected = await openFileDialog({
        multiple: true,
        directory: false,
        title: "选择要上传的文件",
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;
      const newFiles = await loadLocalFiles(paths);
      setSftpFiles(prev => {
        if (!append) return newFiles;
        const map = new Map(prev.map(item => [item.path, item]));
        newFiles.forEach(item => map.set(item.path, item));
        return Array.from(map.values());
      });
      setSftpTargetNode(node);
      setSftpMessage(null);
      setSftpOpen(true);
      setSftpFileProgress({});
      setSftpOverallSent(0);
      setSftpOverallTotal(0);
      if (!append) {
        if (newFiles.length === 1) setSftpRemotePath(`~/${newFiles[0].name}`);
        else setSftpRemotePath("~/");
      }
    } catch (err) {
      console.error("选择文件失败:", err);
    }
  };

  const handleSftpUpload = async () => {
    if (!sftpTargetNode?.config || sftpFiles.length === 0 || !sftpRemotePath) return;
    if (progressUnlistenRef.current) {
      progressUnlistenRef.current();
      progressUnlistenRef.current = null;
    }
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const progressEvent = `sftp-upload-progress-${uploadId}`;
    setSftpUploading(true);
    setSftpMessage(null);

    const totalBytes = sftpFiles.reduce((acc, item) => acc + (item.size || 0), 0);
    setSftpOverallTotal(totalBytes);
    setSftpOverallSent(0);
    setSftpFileProgress(Object.fromEntries(sftpFiles.map(item => [item.path, { sent: 0, total: item.size }])));

    try {
      progressUnlistenRef.current = await listen<SftpUploadProgressPayload>(progressEvent, (event) => {
        const payload = event.payload;
        setSftpOverallTotal(payload.overall_total);
        setSftpOverallSent(payload.overall_sent);
        setSftpFileProgress(prev => ({
          ...prev,
          [payload.local_path]: { sent: payload.file_sent, total: payload.file_size },
        }));
      });

      const isBatch = sftpFiles.length > 1;
      const files = sftpFiles.map(item => ({
        local_path: item.path,
        remote_path: resolveRemotePath(sftpRemotePath, item.name, isBatch),
      }));

      const cfg = sftpTargetNode.config;
      await invoke("sftp_upload_files", {
        config: {
          host: cfg.host,
          port: cfg.port,
          username: cfg.username,
          password: cfg.authType === "password" ? cfg.password : undefined,
          private_key_path: cfg.authType === "privateKey" ? cfg.privateKeyPath : undefined,
        },
        files,
        progressEvent,
      });

      setSftpMessageType("success");
      setSftpMessage("上传成功");
    } catch (err: unknown) {
      console.error("SFTP 上传失败:", err);
      setSftpMessageType("error");
      setSftpMessage(err instanceof Error ? err.message : String(err));
    } finally {
      if (progressUnlistenRef.current) {
        progressUnlistenRef.current();
        progressUnlistenRef.current = null;
      }
      setSftpUploading(false);
    }
  };

  const handleAction = (type: string, node: SessionNode) => {
    if (type === 'connect' && node.config) {
      addSession({ title: node.name, type: "ssh", host: node.config.host, config: { host: node.config.host, port: node.config.port, sshConfig: node.config } });
    } else if (type === 'new-ssh') { setTargetNode(node); setEditNode(null); setSshOpen(true); }
    else if (type === 'new-folder') { setTargetNode(node); setEditNode(null); setFolderOpen(true); }
    else if (type === 'edit') { 
      setEditNode(node); 
      if (node.type === 'folder') { setTempName(node.name); setFolderOpen(true); } 
      else setSshOpen(true);
    } else if (type === 'delete') { setTargetNode(node); setDeleteOpen(true); }
    else if (type === 'sftp-upload') { handleSftpPickFiles(node); }
  };

  const handleDirectConnect = (name: string, path: string, admin = false) => {
    const title = `${name}${admin ? ' (Admin)' : ''}`;
    
    addSession({
      title,
      type: "local",
      config: { 
        shell: path,
        admin,
      }
    });
  };

  const getShellIcon = (type: string) => {
    switch (type) {
      case 'powershell': return <MonitorCheck className="mr-2 h-4 w-4 text-blue-500" />;
      case 'cmd': return <TerminalIcon className="mr-2 h-4 w-4 text-muted-foreground" />;
      case 'bash': return <TerminalIcon className="mr-2 h-4 w-4 text-orange-500" />;
      default: return <TerminalIcon className="mr-2 h-4 w-4" />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-background/50 border-r">
      <div className="h-[var(--th)] px-3 border-b bg-muted/20 flex items-center justify-between group">
        <h3 className="text-xs font-bold uppercase text-muted-foreground tracking-widest select-none">会话</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className={cn(
                "h-7 w-7 transition-all duration-200",
                "bg-accent/50 hover:bg-accent text-accent-foreground shadow-sm",
                "opacity-80 group-hover:opacity-100"
              )}
            >
              <PlusCircle className="h-4.5 w-4.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" sideOffset={4} alignOffset={30} className="w-44 overflow-hidden">
            <DropdownMenuLabel className="text-[10px] font-bold text-muted-foreground uppercase py-2 bg-muted/30">快速连接</DropdownMenuLabel>
            
            {availableShells.map((shell) => (
              <React.Fragment key={shell.path}>
                <DropdownMenuItem onClick={() => handleDirectConnect(shell.name, shell.path)}>
                  {getShellIcon(shell.icon_type)}
                  {shell.name}
                </DropdownMenuItem>
                {/* Windows 下所有本地 Shell (CMD, PS, Bash) 都显示管理员选项 */}
                <DropdownMenuItem onClick={() => handleDirectConnect(shell.name, shell.path, true)}>
                  <ShieldAlert className="mr-2 h-4 w-4 text-amber-500" />
                  {shell.name} 管理员
                </DropdownMenuItem>
              </React.Fragment>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDirectSshOpen(true)}>
              <Server className="mr-2 h-4 w-4 text-emerald-500" /> SSH 连接
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      <div className="flex-1 overflow-y-auto py-2 px-1">
        <DndContext 
          sensors={sensors} 
          collisionDetection={closestCenter} 
          onDragStart={(e) => updateDragState(e.active.id as string, null, null)}
          onDragOver={(e) => {
            const { active, over } = e;

            if (!over || active.id === over.id) {
              updateDragState(active.id as string, null, null);
              return;
            }

            const overNode = nodes.find((node) => node.id === over.id);
            const activeRect = active.rect.current.translated ?? active.rect.current.initial;
            const nextDropPos = overNode ? getDropPosition(overNode, activeRect, over.rect) : null;

            updateDragState(active.id as string, over.id as string, nextDropPos);
          }}
          onDragEnd={(e) => {
            const { active, over } = e;
            if (over && active.id !== over.id) {
              const overNode = nodes.find((node) => node.id === over.id);
              const activeRect = active.rect.current.translated ?? active.rect.current.initial;
              const dropPos = overNode ? getDropPosition(overNode, activeRect, over.rect) : null;

              if (dropPos) {
                moveNode(active.id as string, over.id as string, dropPos);
              }
            }
            updateDragState(null, null, null);
          }}
          onDragCancel={() => updateDragState(null, null, null)}
        >
          <div className="flex flex-col">
            {sortedNodes.map((fn) => (
              <DraggableDroppableRow
                key={fn.id}
                node={fn}
                depth={fn.depth}
                onAction={handleAction}
                overId={dragState.overId}
                dropPos={dragState.dropPos}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>
            {activeDragNode ? (
              <NodeRowContent isOverlay node={activeDragNode} depth={0} />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editNode ? "重命名" : "新建文件夹"}</DialogTitle></DialogHeader>
          <Input 
            value={tempName} 
            onChange={(e) => setTempName(e.target.value)} 
            placeholder="请输入名称" 
            autoFocus 
            onKeyDown={e => e.key === 'Enter' && (editNode ? updateNode(editNode.id, { name: tempName }) : targetNode && addFolder(tempName, targetNode.id), setFolderOpen(false), setTempName(""))}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFolderOpen(false)}>取消</Button>
            <Button onClick={() => {
              if (editNode) updateNode(editNode.id, { name: tempName });
              else if (targetNode) addFolder(tempName, targetNode.id);
              setFolderOpen(false); setTempName("");
            }}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SshConnectDialog open={sshOpen} onOpenChange={setSshOpen} initialConfig={editNode?.config} onSave={(cfg) => {
        if (editNode) updateNode(editNode.id, { config: cfg, name: cfg.nickname || cfg.host });
        else if (targetNode) addProfile(cfg, targetNode.id);
        setSshOpen(false);
      }} />
      <SshConnectDialog open={directSshOpen} onOpenChange={setDirectSshOpen} isDirect={true} onSave={(cfg) => {
        addSession({ 
          title: cfg.nickname || cfg.host, 
          type: "ssh", 
          host: cfg.host, 
          config: { host: cfg.host, port: cfg.port, sshConfig: cfg } 
        });
        setDirectSshOpen(false);
      }} />
      <Dialog open={sftpOpen} onOpenChange={setSftpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>SFTP 上传文件</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">本地文件</div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    已选择 {sftpFiles.length} 个文件 / {formatBytes(sftpSelectedTotal)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => sftpTargetNode && handleSftpPickFiles(sftpTargetNode, true)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> 添加文件
                  </Button>
                </div>
              </div>
              <div className="rounded-md border bg-muted/20">
                {sftpFiles.length === 0 ? (
                  <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                    暂无文件，请添加要上传的文件
                  </div>
                ) : (
                  <div className="divide-y">
                    {sftpFiles.map((item) => {
                      const progress = sftpFileProgress[item.path];
                      const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.sent / progress.total) * 100)) : 0;
                      return (
                        <div key={item.path} className="group px-3 py-2">
                          <div className="flex items-center gap-2">
                            <File className="h-4 w-4 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm truncate">{item.name}</div>
                              <div className="text-xs text-muted-foreground">{formatBytes(item.size)}</div>
                            </div>
                            <button
                              type="button"
                              className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive"
                              onClick={() => setSftpFiles(prev => prev.filter(file => file.path !== item.path))}
                              aria-label="移除文件"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          {sftpUploading && progress && (
                            <div className="mt-2">
                              <div className="h-1.5 w-full rounded-full bg-muted">
                                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${percent}%` }} />
                              </div>
                              <div className="mt-1 text-[10px] text-muted-foreground">{percent}%</div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">远程路径</div>
              <Input 
                value={sftpRemotePath} 
                onChange={(e) => setSftpRemotePath(e.target.value)} 
                placeholder="例如: /home/user/file.txt 或 ~/file.txt"
              />
              {sftpFiles.length > 1 && (
                <div className="text-[10px] text-muted-foreground">
                  批量上传时，远程路径将作为目录使用
                </div>
              )}
            </div>
            {sftpUploading && sftpOverallTotal > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>总进度</span>
                  <span>{formatBytes(sftpOverallSent)} / {formatBytes(sftpOverallTotal)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${Math.min(100, Math.round((sftpOverallSent / sftpOverallTotal) * 100))}%` }}
                  />
                </div>
              </div>
            )}
            {sftpMessage && (
              <div className={cn(
                "text-xs px-2 py-1 rounded border",
                sftpMessageType === "success" ? "bg-green-100 text-green-800 border-green-200" : "bg-red-100 text-red-800 border-red-200"
              )}>
                {sftpMessage}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSftpOpen(false)}>取消</Button>
            <Button onClick={handleSftpUpload} disabled={sftpUploading || sftpFiles.length === 0 || !sftpRemotePath}>
              {sftpUploading ? "上传中..." : "开始上传"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除 "{targetNode?.name}"？</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive" onClick={() => targetNode && removeNode(targetNode.id)}>删除</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
