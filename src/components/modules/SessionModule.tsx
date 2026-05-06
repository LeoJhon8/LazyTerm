import React, { useState, useMemo, useEffect } from "react";
import { 
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay, 
  useDraggable, useDroppable
} from "@dnd-kit/core";
import { 
  Folder, Server, ChevronRight, ChevronDown, Plus, FolderPlus, 
  Pencil, Trash2, Terminal, Upload, AppWindow, ScreenShare, Usb
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSshProfilesStore, type SessionNode } from "@/store/ssh-profiles";
import { useTabsStore } from "@/store/tabs";
import { usePanesStore } from "@/store/panes";
import { SshConnectDialog } from "@/components/dialogs/SshConnectDialog";
import { RdpConnectDialog } from "@/components/dialogs/RdpConnectDialog";
import { VncConnectDialog } from "@/components/dialogs/VncConnectDialog";
import { SerialConnectDialog } from "@/components/dialogs/SerialConnectDialog";
import { TelnetConnectDialog } from "@/components/dialogs/TelnetConnectDialog";
import { SftpUploadDialog } from "@/components/dialogs/SftpUploadDialog";
import { AiCliDialog } from "@/components/dialogs/AiCliDialog";
import { 
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator 
} from "@/components/ui/context-menu";
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel 
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Terminal as TerminalIcon, ShieldAlert, MonitorCheck, Boxes } from "lucide-react";
import type { RDPConfig, SSHConfig, VNCConfig, SerialConfig, TelnetConfig, AiCliConfig } from "@/types/terminal";
import type { ShellInfo } from "@/types/shell";
import { getAvailableShells } from "@/services/shellService";
import { logger } from "@/lib/logger";
import { useDialogState } from "@/hooks/useDialogState";
import { useI18n } from "@/i18n";
import { onQuickConnect } from "@/lib/quick-connect-event";

const IS_WINDOWS = typeof window !== "undefined" && navigator.userAgent.toLowerCase().includes("windows");

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
        "flex items-center gap-2 py-2 px-2 rounded-lg text-sm transition-all relative border-y border-transparent",
        !isOverlay && "group hover:bg-accent/50",
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
          <div>
            {node.type === "rdp"
              ? <AppWindow className="h-4 w-4 text-sky-600/80" />
              : node.type === "vnc"
              ? <ScreenShare className="h-4 w-4 text-emerald-600/80" />
              : node.type === "serial"
              ? <Usb className="h-4 w-4 text-purple-600/80" />
              : node.type === "telnet"
              ? <Terminal className="h-4 w-4 text-emerald-500/80" />
              : node.type === "ai-cli"
              ? <Terminal className="h-4 w-4 text-violet-600/80" />
              : <Server className={cn("h-4 w-4 text-emerald-600/80", isUploading && "text-amber-700 dark:text-cyan-300 animate-pulse")} />
            }
          </div>
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
}: {
  node: SessionNode;
  depth: number;
  onAction: (type: string, node: SessionNode) => void;
  overId: string | null;
  dropPos: DropPosition | null;
}) {
  const { t } = useI18n();
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
      <ContextMenuContent className="w-52 text-xs">
        {node.type === 'folder' ? (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-ssh', node)}><Server className="mr-2 h-4 w-4" /> {t("新建 SSH 连接")}</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-rdp', node)}><AppWindow className="mr-2 h-4 w-4" /> {t("新建 Windows 连接")}</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-vnc', node)}><ScreenShare className="mr-2 h-4 w-4" /> {t("新建 VNC 连接")}</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-serial', node)}><Usb className="mr-2 h-4 w-4" /> {t("新建串口连接（菜单）")}</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-telnet', node)}><Terminal className="mr-2 h-4 w-4" /> {t("新建 Telnet 连接（菜单）")}</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-ai-cli', node)}><Terminal className="mr-2 h-4 w-4" /> {t("新建 AI CLI 连接")}</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-folder', node)}><FolderPlus className="mr-2 h-4 w-4" /> {t("新建子文件夹")}</ContextMenuItem>
          </>
        ) : node.type === 'ssh' ? (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('connect', node)}><Terminal className="mr-2 h-4 w-4" /> {t("连接会话")}</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('sftp-upload', node)}><Upload className="mr-2 h-4 w-4" /> {t("SFTP 上传文件")}</ContextMenuItem>
          </>
        ) : node.type === 'rdp' ? (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('connect', node)}><AppWindow className="mr-2 h-4 w-4" /> {t("连接")}</ContextMenuItem>
          </>
        ) : node.type === 'serial' ? (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('connect', node)}><Usb className="mr-2 h-4 w-4" /> {t("连接")}</ContextMenuItem>
          </>
        ) : node.type === 'telnet' ? (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('connect', node)}><Terminal className="mr-2 h-4 w-4" /> {t("连接")}</ContextMenuItem>
          </>
        ) : node.type === 'ai-cli' ? (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('connect', node)}><Terminal className="mr-2 h-4 w-4" /> {t("连接")}</ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('connect', node)}><ScreenShare className="mr-2 h-4 w-4" /> {t("连接")}</ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('edit', node)}><Pencil className="mr-2 h-4 w-4" /> {t("编辑")}</ContextMenuItem>
        {!node.isRoot && <ContextMenuItem onClick={() => onAction('delete', node)} className="py-1 text-xs text-destructive"><Trash2 className="mr-2 h-4 w-4" /> {t("删除")}</ContextMenuItem>}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function SessionModule() {
  const { locale, t } = useI18n();
  const { nodes, addFolder, addProfile, removeNode, updateNode, moveNode, ensureRoot, syncRootFolderName } = useSshProfilesStore();
  const { addTab, setActiveTabId, addSession } = useTabsStore();

  /**
   * 判断当前 tab 是否可以被覆盖（替换）
   * 条件：当前 tab 存在 + 仅有 1 个 pane + 该 pane 关联的 session 类型为 local
   */
  const canReplaceCurrentTab = (): { tabId: string; paneId: string; oldSessionId: string } | null => {
    const tabsStore = useTabsStore.getState();
    const panesStore = usePanesStore.getState();
    const currentTabId = tabsStore.activeTabId;
    if (!currentTabId) return null;

    const ws = panesStore.getWorkspace(currentTabId);
    if (!ws.rootNode) return null;

    const leaves = panesStore.getAllLeaves(currentTabId);
    if (leaves.length !== 1) return null;

    const soleLeaf = leaves[0];
    if (!soleLeaf.sessionId) return null;

    const session = tabsStore.sessions.find(s => s.id === soleLeaf.sessionId);
    if (!session || session.type !== "local") return null;

    return { tabId: currentTabId, paneId: soleLeaf.id, oldSessionId: soleLeaf.sessionId };
  };

  const launchWorkspaceWithSession = (sessionData: Parameters<typeof addSession>[0]) => {
    // 尝试覆盖当前本地终端 tab
    const replaceTarget = canReplaceCurrentTab();
    if (replaceTarget) {
      // 覆盖模式：关闭旧 session → 替换 pane 的 sessionId → 更新 tab 标题
      useTabsStore.getState().removeSession(replaceTarget.oldSessionId);
      const sessionId = addSession(sessionData);
      usePanesStore.getState().setPaneSession(replaceTarget.paneId, sessionId);
      useTabsStore.getState().updateTab(replaceTarget.tabId, { title: sessionData.title });
      return;
    }

    // 新建模式：原有逻辑
    const tabId = addTab({ title: sessionData.title });
    setActiveTabId(tabId);
    const sessionId = addSession(sessionData);
    usePanesStore.getState().addPane(sessionId);
  };

  // 拖拽状态
  const [dragState, setDragState] = useState<{
    activeId: string | null;
    overId: string | null;
    dropPos: DropPosition | null;
  }>({ activeId: null, overId: null, dropPos: null });

  // 弹窗状态管理
  const dialog = useDialogState();
  const [tempName, setTempName] = useState("");
  const [targetNode, setTargetNode] = useState<SessionNode | null>(null);
  const [editNode, setEditNode] = useState<SessionNode | null>(null);
  const [sftpNode, setSftpNode] = useState<SessionNode | null>(null);

  // 可用 Shell 列表
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);

  useEffect(() => { 
    ensureRoot(); 
    syncRootFolderName();
  }, [ensureRoot, syncRootFolderName, locale]);

  useEffect(() => {
    getAvailableShells()
      .then(setAvailableShells)
      .catch(err => logger.error("FE/session-module/shells", "Failed to get available shells", {err}));
  }, []);

  // 监听来自 WelcomePage 的快速连接请求
  useEffect(() => {
    const dialogMap: Record<string, Parameters<typeof dialog.open>[0]> = {
      ssh: "directSsh",
      rdp: "directRdp",
      vnc: "directVnc",
      serial: "directSerial",
      telnet: "directTelnet",
    };
    const cleanup = onQuickConnect((type) => {
      const dialogType = dialogMap[type];
      if (dialogType) dialog.open(dialogType);
    });
    return cleanup;
  }, [dialog]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const sortedNodes = useMemo(() => getSortedFlattenedNodes(nodes), [nodes]);

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

  const isVncConfig = (config: SessionNode["config"]): config is VNCConfig => {
    return !!config && !("username" in config) && !("authType" in config) && !("baudRate" in config);
  };

  const isSerialConfig = (config: SessionNode["config"]): config is SerialConfig => {
    return !!config && "baudRate" in config;
  };

  const isTelnetConfig = (config: SessionNode["config"]): config is TelnetConfig => {
    return !!config && !("baudRate" in config) && !("authType" in config) && !("username" in config) && "host" in config && "port" in config;
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

  const openDialog = (type: Parameters<typeof dialog.open>[0], node: SessionNode | null = null) => {
    setTargetNode(node);
    if (node?.type === 'folder') {
      setTempName(node.name);
    } else {
      setTempName("");
    }
    dialog.open(type, node?.id ?? null, node?.type === 'folder' ? node.name : "");
  };

  const handleAction = (type: string, node: SessionNode) => {
    if (type === 'connect' && node.config) {
      if (node.type === "ssh" && isSshConfig(node.config)) {
        launchWorkspaceWithSession({ title: node.name, type: "ssh", host: node.config.host, config: { host: node.config.host, port: node.config.port, sshConfig: node.config } });
      } else if (node.type === "rdp" && isRdpConfig(node.config)) {
        const rdpConfig = IS_WINDOWS
          ? { ...node.config, backend: "msrdpax" as const, width: undefined, height: undefined, autoResize: true }
          : node.config;
        launchWorkspaceWithSession({ title: node.name, type: "rdp", host: rdpConfig.host, config: { host: rdpConfig.host, port: rdpConfig.port, rdpConfig } });
      } else if (node.type === "vnc" && isVncConfig(node.config)) {
        launchWorkspaceWithSession({ title: node.name, type: "vnc", host: node.config.host, config: { host: node.config.host, port: node.config.port, vncConfig: node.config } });
      } else if (node.type === "serial" && isSerialConfig(node.config)) {
        launchWorkspaceWithSession({ title: node.name, type: "serial", host: node.config.port, config: { serialConfig: node.config } });
      } else if (node.type === "telnet" && isTelnetConfig(node.config)) {
        launchWorkspaceWithSession({ title: node.name, type: "telnet", host: node.config.host, config: { telnetConfig: node.config } });
      } else if (node.type === "ai-cli" && node.config) {
        launchWorkspaceWithSession({ title: node.name, type: "ai-cli", config: { aiCliConfig: node.config as AiCliConfig } });
      }
    } else if (type === 'new-ssh') { setEditNode(null); openDialog('ssh', node); }
    else if (type === 'new-rdp') { setEditNode(null); openDialog('rdp', node); }
    else if (type === 'new-vnc') { setEditNode(null); openDialog('vnc', node); }
    else if (type === 'new-serial') { setEditNode(null); openDialog('serial', node); }
    else if (type === 'new-telnet') { setEditNode(null); openDialog('telnet', node); }
    else if (type === 'new-ai-cli') { setEditNode(null); openDialog('ai-cli', node); }
    else if (type === 'new-folder') { setEditNode(null); openDialog('folder', node); }
    else if (type === 'edit') { 
      setEditNode(node); 
      if (node.type === 'folder') openDialog('folder', node);
      else if (node.type === 'ssh') openDialog('ssh', node);
      else if (node.type === 'rdp') openDialog('rdp', node);
      else if (node.type === 'serial') openDialog('serial', node);
      else if (node.type === 'telnet') openDialog('telnet', node);
      else if (node.type === 'ai-cli') openDialog('ai-cli', node);
      else openDialog('vnc', node);
    } else if (type === 'delete') { setTargetNode(node); dialog.open('delete', node.id); }
    else if (type === 'sftp-upload' && node.type === 'ssh') { setSftpNode(node); dialog.open('sftp', node.id); }
  };



  const handleDirectRdpConnect = (config: RDPConfig) => {
    const normalizedConfig = IS_WINDOWS
      ? { ...config, backend: "msrdpax" as const, width: undefined, height: undefined, autoResize: true }
      : config;

    launchWorkspaceWithSession({
      title: normalizedConfig.nickname || normalizedConfig.host,
      type: "rdp",
      host: normalizedConfig.host,
      config: {
        host: normalizedConfig.host,
        port: normalizedConfig.port,
        rdpConfig: normalizedConfig,
      }
    });
  };

  const handleDirectVncConnect = (config: VNCConfig) => {
    launchWorkspaceWithSession({
      title: config.nickname || config.host,
      type: "vnc",
      host: config.host,
      config: {
        host: config.host,
        port: config.port,
        vncConfig: config,
      }
    });
  };

  const handleDirectAiCliConnect = (config: AiCliConfig) => {
    launchWorkspaceWithSession({
      title: config.nickname || config.command,
      type: "ai-cli",
      config: {
        aiCliConfig: config,
      }
    });
  };

  const getShellIcon = (type: string) => {
    switch (type) {
      case 'powershell': return <MonitorCheck className="mr-2 h-4 w-4 text-blue-500" />;
      case 'cmd': return <TerminalIcon className="mr-2 h-4 w-4 text-muted-foreground" />;
      case 'bash': return <TerminalIcon className="mr-2 h-4 w-4 text-orange-500" />;
      case 'wsl': return <Boxes className="mr-2 h-4 w-4 text-purple-500" />;
      default: return <TerminalIcon className="mr-2 h-4 w-4" />;
    }
  };

  return (
    <div className="module-shell">
      <div className="module-header group shrink-0 border-b-0">
        <div className="module-title min-w-0">
          <span className="module-heading truncate text-[15px]">{t("会话")}</span>
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
            <DropdownMenuLabel className="text-[10px] font-bold text-muted-foreground uppercase py-2 bg-muted/30">{t("快速连接")}</DropdownMenuLabel>
            
            {availableShells.map((shell, index) => (
              <React.Fragment key={`${shell.path}-${index}`}>
                <DropdownMenuItem onClick={() => launchWorkspaceWithSession({
                  title: shell.name,
                  type: "local",
                  config: { shell: shell.path, admin: false }
                })}>
                  {getShellIcon(shell.icon_type)}
                  {shell.name}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => launchWorkspaceWithSession({
                  title: t("{name} (管理员)", { name: shell.name }),
                  type: "local",
                  config: { shell: shell.path, admin: true }
                })}>
                  <ShieldAlert className="mr-2 h-4 w-4 text-amber-500" />
                  {t("{name} 管理员", { name: shell.name })}
                </DropdownMenuItem>
              </React.Fragment>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => dialog.open('directSsh')}>
              <Server className="mr-2 h-4 w-4 text-emerald-500" /> {t("SSH 连接")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => dialog.open('directRdp')}>
              <AppWindow className="mr-2 h-4 w-4 text-sky-500" /> {t("Windows 远程连接")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => dialog.open('directVnc')}>
              <ScreenShare className="mr-2 h-4 w-4 text-emerald-500" /> {t("VNC 连接")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => dialog.open('directSerial')}>
              <Usb className="mr-2 h-4 w-4 text-purple-500" /> {t("串口连接")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => dialog.open('directTelnet')}>
              <Terminal className="mr-2 h-4 w-4 text-emerald-500" /> {t("Telnet 连接")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => dialog.open('directAiCli')}>
              <Terminal className="mr-2 h-4 w-4 text-violet-500" /> {t("AI CLI 连接")}
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

      {/* 文件夹弹窗 */}
      <Dialog open={dialog.isOpen('folder')} onOpenChange={() => dialog.close()}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editNode ? t("重命名") : t("新建文件夹")}</DialogTitle></DialogHeader>
          <Input 
            value={tempName} 
            onChange={(e) => setTempName(e.target.value)} 
            placeholder={t("请输入名称")}
            autoFocus 
            onKeyDown={e => e.key === 'Enter' && (editNode ? updateNode(editNode.id, { name: tempName }) : targetNode && addFolder(tempName, targetNode.id), dialog.close(), setTempName(""))}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => dialog.close()}>{t("取消")}</Button>
            <Button onClick={() => {
              if (editNode) updateNode(editNode.id, { name: tempName });
              else if (targetNode) addFolder(tempName, targetNode.id);
              dialog.close(); setTempName("");
            }}>{t("确定")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SSH 弹窗 */}
      <SshConnectDialog 
        open={dialog.isOpen('ssh')} 
        onOpenChange={() => dialog.close()} 
        initialConfig={editNode?.type === "ssh" ? editNode.config as SSHConfig : undefined} 
        onSave={(cfg) => {
          if (editNode) updateNode(editNode.id, { config: cfg, name: cfg.nickname || cfg.host });
          else if (targetNode) addProfile("ssh", cfg, targetNode.id);
          dialog.close();
        }} 
      />

      {/* RDP 弹窗 */}
      <RdpConnectDialog 
        open={dialog.isOpen('rdp')} 
        onOpenChange={() => dialog.close()} 
        initialConfig={editNode?.type === "rdp" ? editNode.config as RDPConfig : undefined} 
        onSave={(cfg) => {
          if (editNode) updateNode(editNode.id, { config: cfg, name: cfg.nickname || cfg.host });
          else if (targetNode) addProfile("rdp", cfg, targetNode.id);
          dialog.close();
        }} 
      />

      {/* VNC 弹窗 */}
      <VncConnectDialog 
        open={dialog.isOpen('vnc')} 
        onOpenChange={() => dialog.close()} 
        initialConfig={editNode?.type === "vnc" ? editNode.config as VNCConfig : undefined} 
        onSave={(cfg) => {
          if (editNode) updateNode(editNode.id, { config: cfg, name: cfg.nickname || cfg.host });
          else if (targetNode) addProfile("vnc", cfg, targetNode.id);
          dialog.close();
        }} 
      />

      {/* 串口 弹窗 */}
      <SerialConnectDialog 
        open={dialog.isOpen('serial')} 
        onOpenChange={() => dialog.close()} 
        initialConfig={editNode?.type === "serial" ? editNode.config as SerialConfig : undefined} 
        onSave={(cfg) => {
          if (editNode) updateNode(editNode.id, { config: cfg, name: cfg.nickname || cfg.port });
          else if (targetNode) addProfile("serial", cfg, targetNode.id);
          dialog.close();
        }} 
      />

      {/* Telnet 弹窗 */}
      <TelnetConnectDialog 
        open={dialog.isOpen('telnet')} 
        onOpenChange={() => dialog.close()} 
        initialConfig={editNode?.type === "telnet" ? editNode.config as TelnetConfig : undefined} 
        onSave={(cfg) => {
          if (editNode) updateNode(editNode.id, { config: cfg, name: cfg.nickname || cfg.host });
          else if (targetNode) addProfile("telnet", cfg, targetNode.id);
          dialog.close();
        }} 
      />

      {/* AI CLI 弹窗 */}
      <AiCliDialog 
        open={dialog.isOpen('ai-cli')} 
        onOpenChange={() => dialog.close()} 
        initialConfig={editNode?.type === "ai-cli" ? editNode.config as AiCliConfig : undefined} 
        onSave={(cfg) => {
          if (editNode) updateNode(editNode.id, { config: cfg, name: cfg.nickname || cfg.command });
          else if (targetNode) addProfile("ai-cli" as any, cfg, targetNode.id);
          dialog.close();
        }} 
      />

      {/* 直接连接弹窗 */}
      <SshConnectDialog
        open={dialog.isOpen('directSsh')}
        onOpenChange={() => dialog.close()}
        isDirect={true}
        onSave={(cfg) => {
          launchWorkspaceWithSession({
            title: cfg.nickname || cfg.host,
            type: "ssh",
            host: cfg.host,
            config: { host: cfg.host, port: cfg.port, sshConfig: cfg }
          });
          dialog.close();
        }}
      />
      <RdpConnectDialog 
        open={dialog.isOpen('directRdp')} 
        onOpenChange={() => dialog.close()} 
        isDirect={true} 
        onSave={(cfg) => {
          handleDirectRdpConnect(cfg);
          dialog.close();
        }} 
      />
      <VncConnectDialog 
        open={dialog.isOpen('directVnc')} 
        onOpenChange={() => dialog.close()} 
        isDirect={true} 
        onSave={(cfg) => {
          handleDirectVncConnect(cfg);
          dialog.close();
        }} 
      />
      <SerialConnectDialog 
        open={dialog.isOpen('directSerial')} 
        onOpenChange={() => dialog.close()} 
        isDirect={true} 
        onSave={(cfg) => {
          launchWorkspaceWithSession({
            title: cfg.nickname || cfg.port,
            type: "serial",
            host: cfg.port,
            config: { serialConfig: cfg }
          });
          dialog.close();
        }} 
      />
      <TelnetConnectDialog 
        open={dialog.isOpen('directTelnet')} 
        onOpenChange={() => dialog.close()} 
        isDirect={true} 
        onSave={(cfg) => {
          launchWorkspaceWithSession({
            title: cfg.nickname || cfg.host,
            type: "telnet",
            host: cfg.host,
            config: { telnetConfig: cfg }
          });
          dialog.close();
        }} 
      />

      {/* AI CLI 直接连接弹窗 */}
      <AiCliDialog 
        open={dialog.isOpen('directAiCli')} 
        onOpenChange={() => dialog.close()} 
        isDirect={true} 
        onSave={(cfg) => {
          handleDirectAiCliConnect(cfg);
          dialog.close();
        }} 
      />

      {/* SFTP 上传弹窗 */}
      <SftpUploadDialog
        open={dialog.isOpen('sftp')}
        onOpenChange={() => dialog.close()}
        targetNode={sftpNode}
      />

      {/* 删除确认弹窗 */}
      <AlertDialog open={dialog.isOpen('delete')} onOpenChange={() => dialog.close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("确认删除 “{name}”？", { name: targetNode?.name ?? "" })}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => dialog.close()}>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onClick={() => { 
              if (targetNode) {
                removeNode(targetNode.id);
              }
              dialog.close(); 
            }}>
              {t("删除")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
