import React, { useState, useMemo, useEffect, useRef } from "react";
import { 
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay, 
  useDraggable, useDroppable
} from "@dnd-kit/core";
import { 
  Folder, Server, ChevronRight, ChevronDown, Plus, FolderPlus, 
  Pencil, Trash2, Terminal, Upload, File, X, Monitor
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSshProfilesStore, type SessionNode } from "@/store/ssh-profiles";
import { useTabsStore } from "@/store/tabs";
import { SshConnectDialog } from "@/components/dialogs/SshConnectDialog";
import { RdpConnectDialog } from "@/components/dialogs/RdpConnectDialog";
import { 
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator 
} from "@/components/ui/context-menu";
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel 
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Terminal as TerminalIcon, ShieldAlert, MonitorCheck } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { stat, size as getFileSize } from "@tauri-apps/plugin-fs";
import type { RDPConfig, SSHConfig } from "@/types/terminal";

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
  node, depth, isDragging, isOver, dropPos, isOverlay, isUploading 
}: { 
  node: SessionNode, depth: number, isDragging?: boolean, isOver?: boolean, dropPos?: DropPosition | null, isOverlay?: boolean, isUploading?: boolean 
}) {
  const isFolder = node.type === "folder";
  return (
    <div
      style={{ paddingLeft: `${isOverlay ? 8 : depth * 14 + 6}px` }}
      className={cn(
        "flex items-center gap-2 py-1.5 px-2 rounded-sm text-sm transition-all relative border-y border-transparent",
        !isOverlay && "group hover:bg-accent/40",
        isOverlay && "bg-background border shadow-xl opacity-90 w-60 z-50 pointer-events-none",
        isUploading && !isOverlay && "border-slate-300/80 bg-amber-100/80 text-amber-950 ring-1 ring-amber-300/80 dark:border-cyan-400/40 dark:bg-cyan-500/16 dark:text-cyan-50 dark:ring-cyan-400/45",
        
        // 放置指示器
        isOver && !isDragging && dropPos === 'before' && [
          "before:content-[''] before:absolute before:-top-px before:left-0 before:right-0 before:h-0.5 before:bg-sky-500 before:z-100 bg-sky-500/8"
        ],
        isOver && !isDragging && dropPos === 'after' && [
          "after:content-[''] after:absolute after:-bottom-px after:left-0 after:right-0 after:h-0.5 after:bg-amber-500 after:z-100 bg-amber-500/8"
        ],
        isOver && !isDragging && dropPos === 'inside' && "bg-emerald-500/15 ring-1 ring-emerald-500/40 ring-inset"
      )}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isFolder ? (
          <div className="flex items-center gap-1 text-muted-foreground/60">
            {node.isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Folder className={cn("h-4 w-4", node.isRoot ? "text-amber-500 fill-amber-500/10" : "text-blue-500 fill-blue-500/10")} />
          </div>
        ) : (
          node.type === "rdp"
            ? <Monitor className="h-4 w-4 text-sky-600/80" />
            : <Server className={cn("h-4 w-4 text-emerald-600/80", isUploading && "text-amber-700 dark:text-cyan-300 animate-pulse")} />
        )}
        <span
          title={node.name}
          className={cn(
            "truncate flex-1 select-none",
            node.isRoot ? "font-bold text-foreground" : "font-medium text-muted-foreground group-hover:text-foreground",
            isUploading && "text-amber-950 dark:text-cyan-50"
          )}
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
  uploadingNodeId,
}: {
  node: SessionNode;
  depth: number;
  onAction: (type: string, node: SessionNode) => void;
  overId: string | null;
  dropPos: DropPosition | null;
  uploadingNodeId: string | null;
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
              isUploading={node.type === "ssh" && uploadingNodeId === node.id}
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52 text-xs">
        {node.type === 'folder' ? (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-ssh', node)}><Server className="mr-2 h-4 w-4" /> 新建 SSH 连接</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-rdp', node)}><Monitor className="mr-2 h-4 w-4" /> 新建 RDP 连接</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-folder', node)}><FolderPlus className="mr-2 h-4 w-4" /> 新建子文件夹</ContextMenuItem>
          </>
        ) : node.type === 'ssh' ? (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('connect', node)}><Terminal className="mr-2 h-4 w-4" /> 连接会话</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('sftp-upload', node)}><Upload className="mr-2 h-4 w-4" /> SFTP 上传文件</ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('connect', node)}><Monitor className="mr-2 h-4 w-4" /> 内嵌连接远程桌面</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('connect-msrdpax', node)}><MonitorCheck className="mr-2 h-4 w-4" /> MsTscAx 内嵌连接</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('connect-mstsc', node)}><MonitorCheck className="mr-2 h-4 w-4" /> mstsc 外部窗口连接</ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('edit', node)}><Pencil className="mr-2 h-4 w-4" /> 编辑</ContextMenuItem>
        {!node.isRoot && <ContextMenuItem onClick={() => onAction('delete', node)} className="py-1 text-xs text-destructive"><Trash2 className="mr-2 h-4 w-4" /> 删除</ContextMenuItem>}
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
  const [rdpOpen, setRdpOpen] = useState(false);
  const [directRdpOpen, setDirectRdpOpen] = useState(false);
  const [directMsrdpaxOpen, setDirectMsrdpaxOpen] = useState(false);
  const [directMstscOpen, setDirectMstscOpen] = useState(false);
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
  const [sftpMessageType, setSftpMessageType] = useState<"success" | "error" | "info">("success");
  const [sftpTargetNode, setSftpTargetNode] = useState<SessionNode | null>(null);
  const [sftpFiles, setSftpFiles] = useState<SftpLocalFile[]>([]);
  const [sftpOverallSent, setSftpOverallSent] = useState(0);
  const [sftpOverallTotal, setSftpOverallTotal] = useState(0);
  const [sftpFileProgress, setSftpFileProgress] = useState<Record<string, { sent: number; total: number }>>({});
  const [sftpStopping, setSftpStopping] = useState(false);
  const [mstscError, setMstscError] = useState<string | null>(null);
  const progressUnlistenRef = useRef<UnlistenFn | null>(null);
  const currentSftpUploadIdRef = useRef<string | null>(null);

  useEffect(() => { 
    ensureRoot(); 
    // 获取可用 Shell
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
      currentSftpUploadIdRef.current = null;
    };
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const sortedNodes = useMemo(() => getSortedFlattenedNodes(nodes), [nodes]);
  const sftpSelectedTotal = useMemo(() => sftpFiles.reduce((acc, item) => acc + (item.size || 0), 0), [sftpFiles]);
  const activeSftpNodeId = sftpUploading ? sftpTargetNode?.id ?? null : null;

  const activeDragNode = useMemo(
    () => (dragState.activeId ? nodes.find((node) => node.id === dragState.activeId) ?? null : null),
    [dragState.activeId, nodes]
  );

  const isSshConfig = (config: SessionNode["config"]): config is SSHConfig => {
    return !!config && "authType" in config;
  };

  const isRdpConfig = (config: SessionNode["config"]): config is RDPConfig => {
    return !!config && "username" in config && !("authType" in config);
  };

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

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }

    if (typeof error === "object" && error !== null) {
      const candidate = (error as { message?: unknown }).message;
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    return "未获取到后端返回的详细错误信息。";
  };

  const launchMstscConnection = async (config: RDPConfig) => {
    try {
      await invoke("launch_mstsc_rdp", {
        config: {
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          domain: config.domain,
          width: config.width,
          height: config.height,
          auto_resize: config.autoResize ?? true,
        },
      });
    } catch (error) {
      console.error("启动 mstsc 失败:", error);
      setMstscError(getErrorMessage(error));
    }
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
    if (sftpUploading) {
      if (activeSftpNodeId === node.id) {
        setSftpMessage(null);
        setSftpOpen(true);
        return;
      }
      setSftpMessageType("error");
      setSftpMessage(`连接“${sftpTargetNode?.name ?? "当前连接"}”正在上传，请等待完成后再发起新的上传`);
      setSftpOpen(true);
      return;
    }
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

  const handleSftpOpen = (node: SessionNode) => {
    if (!node.config) return;
    if (sftpUploading) {
      if (activeSftpNodeId === node.id) {
        setSftpMessage(null);
        setSftpOpen(true);
        return;
      }
      setSftpMessageType("error");
      setSftpMessage(`连接“${sftpTargetNode?.name ?? "当前连接"}”正在上传，请等待完成后再发起新的上传`);
      setSftpOpen(true);
      return;
    }

    setSftpTargetNode(node);
    setSftpFiles([]);
    setSftpRemotePath("");
    setSftpMessage(null);
    setSftpFileProgress({});
    setSftpOverallSent(0);
    setSftpOverallTotal(0);
    setSftpStopping(false);
    setSftpOpen(true);
  };

  const handleStopSftpUpload = async () => {
    const uploadId = currentSftpUploadIdRef.current;
    if (!uploadId || !sftpUploading || sftpStopping) return;

    try {
      setSftpStopping(true);
      setSftpMessageType("info");
      setSftpMessage("正在停止上传...");
      await invoke("cancel_sftp_upload", { uploadId });
    } catch (err) {
      console.error("停止 SFTP 上传失败:", err);
      setSftpStopping(false);
      setSftpMessageType("error");
      setSftpMessage(err instanceof Error ? err.message : String(err));
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
    currentSftpUploadIdRef.current = uploadId;
    setSftpUploading(true);
    setSftpStopping(false);
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
      if (!isSshConfig(cfg)) {
        throw new Error("SFTP 仅支持 SSH 会话");
      }
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
        uploadId,
      });

      setSftpMessageType("success");
      setSftpMessage("上传成功");
    } catch (err: unknown) {
      console.error("SFTP 上传失败:", err);
      const message = err instanceof Error ? err.message : String(err);
      const isStopped = message.includes("上传已停止");
      setSftpMessageType(isStopped ? "info" : "error");
      setSftpMessage(isStopped ? "上传已停止" : message);
    } finally {
      if (progressUnlistenRef.current) {
        progressUnlistenRef.current();
        progressUnlistenRef.current = null;
      }
      setSftpUploading(false);
      setSftpStopping(false);
      currentSftpUploadIdRef.current = null;
    }
  };

  const handleAction = (type: string, node: SessionNode) => {
    if (type === 'connect' && node.config) {
      if (node.type === "ssh" && isSshConfig(node.config)) {
        addSession({ title: node.name, type: "ssh", host: node.config.host, config: { host: node.config.host, port: node.config.port, sshConfig: node.config } });
      } else if (node.type === "rdp" && isRdpConfig(node.config)) {
        addSession({ title: node.name, type: "rdp", host: node.config.host, config: { host: node.config.host, port: node.config.port, rdpConfig: node.config } });
      }
    } else if (type === 'connect-msrdpax' && node.type === 'rdp' && node.config && isRdpConfig(node.config)) {
      addSession({
        title: `${node.name} (MsTscAx)`,
        type: "rdp",
        host: node.config.host,
        config: {
          host: node.config.host,
          port: node.config.port,
          rdpConfig: {
            ...node.config,
            backend: "msrdpax",
          },
        },
      });
    } else if (type === 'connect-mstsc' && node.type === 'rdp' && node.config && isRdpConfig(node.config)) {
      void launchMstscConnection(node.config);
    } else if (type === 'new-ssh') { setTargetNode(node); setEditNode(null); setSshOpen(true); }
    else if (type === 'new-rdp') { setTargetNode(node); setEditNode(null); setRdpOpen(true); }
    else if (type === 'new-folder') { setTargetNode(node); setEditNode(null); setFolderOpen(true); }
    else if (type === 'edit') { 
      setEditNode(node); 
      if (node.type === 'folder') { setTempName(node.name); setFolderOpen(true); } 
      else if (node.type === 'ssh') setSshOpen(true);
      else setRdpOpen(true);
    } else if (type === 'delete') { setTargetNode(node); setDeleteOpen(true); }
    else if (type === 'sftp-upload' && node.type === 'ssh') { handleSftpOpen(node); }
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

  const handleDirectRdpConnect = (config: RDPConfig) => {
    addSession({
      title: config.nickname || config.host,
      type: "rdp",
      host: config.host,
      config: {
        host: config.host,
        port: config.port,
        rdpConfig: config,
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
    <div className="module-shell">
      <div className="module-header group shrink-0 border-b-0">
        <div className="module-title min-w-0">
          <span className="module-heading truncate text-[15px]">会话</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className={cn(
                "h-9 w-9 rounded-2xl border border-input bg-background/72 text-accent-foreground shadow-none transition-colors duration-200",
                "hover:bg-background/88 hover:text-foreground",
                "opacity-80 group-hover:opacity-100"
              )}
            >
              <Plus className="h-4 w-4" />
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
            <DropdownMenuItem onClick={() => setDirectRdpOpen(true)}>
              <Monitor className="mr-2 h-4 w-4 text-sky-500" /> RDP 内嵌连接
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDirectMsrdpaxOpen(true)}>
              <MonitorCheck className="mr-2 h-4 w-4 text-sky-500" /> MsTscAx 内嵌连接
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDirectMstscOpen(true)}>
              <MonitorCheck className="mr-2 h-4 w-4 text-sky-500" /> mstsc 外部窗口连接
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      <div className="flex-1 overflow-y-auto px-2 pt-0 pb-3">
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
          <div className="flex flex-col gap-1">
            {sortedNodes.map((fn) => (
              <DraggableDroppableRow
                key={fn.id}
                node={fn}
                depth={fn.depth}
                onAction={handleAction}
                overId={dragState.overId}
                dropPos={dragState.dropPos}
                uploadingNodeId={activeSftpNodeId}
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
      <SshConnectDialog open={sshOpen} onOpenChange={setSshOpen} initialConfig={editNode?.type === "ssh" ? editNode.config as SSHConfig : undefined} onSave={(cfg) => {
        if (editNode) updateNode(editNode.id, { config: cfg, name: cfg.nickname || cfg.host });
        else if (targetNode) addProfile("ssh", cfg, targetNode.id);
        setSshOpen(false);
      }} />
      <RdpConnectDialog open={rdpOpen} onOpenChange={setRdpOpen} initialConfig={editNode?.type === "rdp" ? editNode.config as RDPConfig : undefined} onSave={(cfg) => {
        if (editNode) updateNode(editNode.id, { config: cfg, name: cfg.nickname || cfg.host });
        else if (targetNode) addProfile("rdp", cfg, targetNode.id);
        setRdpOpen(false);
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
      <RdpConnectDialog open={directRdpOpen} onOpenChange={setDirectRdpOpen} isDirect={true} onSave={(cfg) => {
        handleDirectRdpConnect(cfg);
        setDirectRdpOpen(false);
      }} />
      <RdpConnectDialog
        open={directMsrdpaxOpen}
        onOpenChange={setDirectMsrdpaxOpen}
        isDirect={true}
        initialConfig={{
          host: "",
          port: 3389,
          username: "",
          backend: "msrdpax",
          autoResize: true,
          width: 1280,
          height: 720,
        }}
        onSave={(cfg) => {
          handleDirectRdpConnect({ ...cfg, backend: "msrdpax" });
          setDirectMsrdpaxOpen(false);
        }}
      />
      <RdpConnectDialog open={directMstscOpen} onOpenChange={setDirectMstscOpen} isDirect={true} onSave={(cfg) => {
        void launchMstscConnection(cfg);
        setDirectMstscOpen(false);
      }} />
      <Dialog open={sftpOpen} onOpenChange={setSftpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>SFTP 上传文件</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {sftpTargetNode && (
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                当前连接: {sftpTargetNode.name}
                {sftpUploading && " · 上传进行中，可先收起后从同连接恢复"}
              </div>
            )}
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
                    disabled={sftpUploading}
                    onClick={() => sftpTargetNode && handleSftpPickFiles(sftpTargetNode, sftpFiles.length > 0)}
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
                              disabled={sftpUploading}
                              className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
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
                disabled={sftpUploading}
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
                sftpMessageType === "success" && "bg-green-100 text-green-800 border-green-200",
                sftpMessageType === "error" && "bg-red-100 text-red-800 border-red-200",
                sftpMessageType === "info" && "bg-sky-100 text-sky-800 border-sky-200 dark:bg-cyan-500/12 dark:text-cyan-100 dark:border-cyan-400/30"
              )}>
                {sftpMessage}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={sftpUploading ? handleStopSftpUpload : () => setSftpOpen(false)} disabled={sftpStopping}>
              {sftpUploading ? (sftpStopping ? "停止中..." : "停止上传") : "取消"}
            </Button>
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
      <AlertDialog open={!!mstscError} onOpenChange={(open) => !open && setMstscError(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>mstsc 启动失败</AlertDialogTitle>
            <AlertDialogDescription>
              Windows 远程桌面客户端未能按当前配置启动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-2xl border border-border/60 bg-black/25 px-4 py-3 text-xs leading-6 text-muted-foreground">
            <div className="font-medium text-foreground">技术详情</div>
            <div className="mt-1 break-all">{mstscError}</div>
          </div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setMstscError(null)}>知道了</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
