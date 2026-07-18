import { useState, useMemo, useEffect, useRef, type MouseEvent } from "react";
import { 
  DndContext, closestCenter, pointerWithin, PointerSensor, useSensor, useSensors, DragOverlay,
  useDraggable, useDroppable, type CollisionDetection, type DragMoveEvent
} from "@dnd-kit/core";
import { 
  Folder, Server, ChevronRight, ChevronDown, Plus, FolderPlus, Zap,
  Copy, Pencil, Trash2, Terminal, Upload, Download, AppWindow, ScreenShare, Usb
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSshProfilesStore, type SessionNode } from "@/store/ssh-profiles";
import { secureConnectionConfig } from "@/store/credentials";
import { useI18n } from "@/i18n";
import { useTabsStore } from "@/store/tabs";
import { usePanesStore } from "@/store/panes";
import { SshConnectDialog } from "@/components/dialogs/SshConnectDialog";
import { RdpConnectDialog } from "@/components/dialogs/RdpConnectDialog";
import { VncConnectDialog } from "@/components/dialogs/VncConnectDialog";
import { SerialConnectDialog } from "@/components/dialogs/SerialConnectDialog";
import { TelnetConnectDialog } from "@/components/dialogs/TelnetConnectDialog";
import { SftpUploadDialog } from "@/components/dialogs/SftpUploadDialog";
import { SftpDownloadDialog } from "@/components/dialogs/SftpDownloadDialog";
import { AiCliDialog } from "@/components/dialogs/AiCliDialog";
import { NewConnectionDialog } from "@/components/dialogs/NewConnectionDialog";
import { QuickConnectDialog } from "@/components/dialogs/QuickConnectDialog";
import { 
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator 
} from "@/components/ui/context-menu";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import type { RDPConfig, SSHConfig, VNCConfig, SerialConfig, TelnetConfig, AiCliConfig } from "@/types/terminal";

import { useDialogState } from "@/hooks/useDialogState";
import { resolveRdpBackend } from "@/lib/rdp-backend";
import { useSettingsStore } from "@/store/settings";
import { logger } from "@/lib/logger";

type DropPosition = 'before' | 'after' | 'inside';

const pointerFirstCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

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
  pointerY: number | null,
  activeRect: { top: number; height: number } | null | undefined,
  overRect: { top: number; height: number } | null | undefined,
): DropPosition | null {
  if (!activeRect || !overRect) return null;

  if (node.isRoot) {
    return 'inside';
  }

  const activeCenterY = activeRect.top + activeRect.height / 2;
  const relativeY = (pointerY ?? activeCenterY) - overRect.top;

  if (node.type === 'folder') {
    if (relativeY < overRect.height * 0.2) return 'before';
    if (relativeY > overRect.height * 0.8) return 'after';
    return 'inside';
  }

  return relativeY < overRect.height * 0.5 ? 'before' : 'after';
}

function NodeRowContent({ 
  node, depth, isDragging, isOver, dropPos, isOverlay, isUploading, isSelected
}: { 
  node: SessionNode, depth: number, isDragging?: boolean, isOver?: boolean, dropPos?: DropPosition | null, isOverlay?: boolean, isUploading?: boolean, isSelected?: boolean
}) {
  const isFolder = node.type === "folder";
  return (
    <div
      style={{ paddingLeft: `${isOverlay ? 8 : depth * 14 + 6}px` }}
      className={cn(
        "flex items-center gap-2 py-2 px-2 rounded-lg text-sm transition-all relative border-y border-transparent",
        !isOverlay && "group hover:bg-accent/50",
        isSelected && !isOverlay && "bg-accent text-accent-foreground ring-1 ring-accent-foreground/15",
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
            node.isRoot ? "font-semibold text-foreground" : "font-medium text-muted-foreground group-hover:text-foreground",
            isSelected && !node.isRoot && "text-accent-foreground",
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
  onSelect,
  overId,
  dropPos,
  isSelected,
  isBulkSelected,
}: {
  node: SessionNode;
  depth: number;
  onAction: (type: string, node: SessionNode) => void;
  onSelect: (node: SessionNode, event: MouseEvent<HTMLDivElement>) => void;
  overId: string | null;
  dropPos: DropPosition | null;
  isSelected: boolean;
  isBulkSelected: boolean;
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
          data-session-node-row
          onClick={(event) => {
            onSelect(node, event);
            if (node.type === 'folder' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
              toggleFolder(node.id);
            }
          }}
          onContextMenu={(event) => onSelect(node, event)}
          onDoubleClick={() => node.type !== 'folder' && onAction('connect', node)}
        >
          <div ref={setDraggableRef} {...attributes} {...listeners} className={cn(isDragging && "opacity-20")}>
            <NodeRowContent 
              node={node} 
              depth={depth} 
              isDragging={isDragging} 
              isOver={isOver && overId === node.id} 
              dropPos={overId === node.id ? dropPos : null} 
              isSelected={isSelected}
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 text-xs">
        {node.type === 'folder' ? (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-connection', node)}><Plus className="mr-2 h-4 w-4" /> {t("新建连接")}</ContextMenuItem>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('new-folder', node)}><FolderPlus className="mr-2 h-4 w-4" /> {t("新建子文件夹")}</ContextMenuItem>
          </>
        ) : node.type === 'ssh' ? (
          <>
            <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('connect', node)}><Terminal className="mr-2 h-4 w-4" /> {t("连接会话")}</ContextMenuItem>
            {!isBulkSelected && (
              <>
                <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('sftp-upload', node)}><Upload className="mr-2 h-4 w-4" /> {t("上传文件")}</ContextMenuItem>
                <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('sftp-download', node)}><Download className="mr-2 h-4 w-4" /> {t("下载文件")}</ContextMenuItem>
              </>
            )}
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
        {!isBulkSelected && node.type !== 'folder' && (
          <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('duplicate', node)}>
            <Copy className="mr-2 h-4 w-4" /> {t("复制")}
          </ContextMenuItem>
        )}
        {!isBulkSelected && <ContextMenuItem className="py-1 text-xs" onClick={() => onAction('edit', node)}><Pencil className="mr-2 h-4 w-4" /> {t("编辑")}</ContextMenuItem>}
        {!node.isRoot && <ContextMenuItem onClick={() => onAction('delete', node)} className="py-1 text-xs text-destructive"><Trash2 className="mr-2 h-4 w-4" /> {t("删除")}</ContextMenuItem>}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function SessionModule() {
  const { locale, t } = useI18n();
  const { nodes, addFolder, addProfile, duplicateProfile, removeNode, updateNode, moveNode, ensureRoot, syncRootFolderName } = useSshProfilesStore();
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
  const pointerYRef = useRef<number | null>(null);

  // 弹窗状态管理
  const dialog = useDialogState();
  const [tempName, setTempName] = useState("");
  const [targetNode, setTargetNode] = useState<SessionNode | null>(null);
  const [editNode, setEditNode] = useState<SessionNode | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);

  const saveRemoteProfile = async (
    type: "ssh" | "rdp" | "vnc",
    config: SSHConfig | RDPConfig | VNCConfig,
    parentId: string | null,
    editing: SessionNode | null,
  ) => {
    try {
      const secured = await secureConnectionConfig(type, config);
      if (editing) {
        updateNode(editing.id, { config: secured, name: config.nickname || config.host });
      } else if (parentId) {
        addProfile(type, secured, parentId);
      }
      dialog.close();
    } catch (error) {
      logger.error("FE/session/save-profile", "保存远程会话凭据失败", { error });
    }
  };
  const [sftpNode, setSftpNode] = useState<SessionNode | null>(null);
  const [initialQuickConnectType, setInitialQuickConnectType] = useState<string | null>(null);

  useEffect(() => { 
    ensureRoot(); 
    syncRootFolderName();
  }, [ensureRoot, syncRootFolderName, locale]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const sortedNodes = useMemo(() => getSortedFlattenedNodes(nodes), [nodes]);
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const deleteTargetNodes = useMemo(() => {
    const targetIds = targetNode && selectedNodeIdSet.has(targetNode.id)
      ? selectedNodeIds
      : targetNode
        ? [targetNode.id]
        : [];
    const targetIdSet = new Set(targetIds);
    return nodes.filter((node) => targetIdSet.has(node.id) && !node.isRoot);
  }, [nodes, selectedNodeIds, selectedNodeIdSet, targetNode]);
  const deleteTargetName = deleteTargetNodes.length === 1
    ? deleteTargetNodes[0].name
    : locale === "zh-CN"
      ? `${deleteTargetNodes.length} 个项目`
      : `${deleteTargetNodes.length} selected items`;

  const activeDragNode = useMemo(
    () => (dragState.activeId ? nodes.find((node) => node.id === dragState.activeId) ?? null : null),
    [dragState.activeId, nodes]
  );

  useEffect(() => {
    const existingIds = new Set(nodes.map((node) => node.id));
    setSelectedNodeIds((prev) => prev.filter((id) => existingIds.has(id)));
    setSelectionAnchorId((prev) => (prev && existingIds.has(prev) ? prev : null));
  }, [nodes]);

  useEffect(() => {
    if (selectedNodeIds.length === 0) return;

    const clearSelection = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-session-node-row]")) return;
      if (target.closest('[role="menu"], [role="dialog"], [data-radix-popper-content-wrapper]')) return;

      setSelectedNodeIds([]);
      setSelectionAnchorId(null);
    };

    document.addEventListener("pointerdown", clearSelection);
    return () => document.removeEventListener("pointerdown", clearSelection);
  }, [selectedNodeIds.length]);

  useEffect(() => {
    if (!dragState.activeId) {
      pointerYRef.current = null;
      return;
    }

    const updatePointerPosition = (event: PointerEvent) => {
      pointerYRef.current = event.clientY;
    };

    document.addEventListener("pointermove", updatePointerPosition, true);
    return () => document.removeEventListener("pointermove", updatePointerPosition, true);
  }, [dragState.activeId]);

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

  const handleDragMove = (event: DragMoveEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      updateDragState(active.id as string, null, null);
      return;
    }

    const overNode = nodes.find((node) => node.id === over.id);
    const activeRect = active.rect.current.translated ?? active.rect.current.initial;
    const nextDropPos = overNode
      ? getDropPosition(overNode, pointerYRef.current, activeRect, over.rect)
      : null;
    updateDragState(active.id as string, over.id as string, nextDropPos);
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

  const handleSelectNode = (node: SessionNode, event: MouseEvent<HTMLDivElement>) => {
    if (node.isRoot) {
      setSelectedNodeIds([]);
      setSelectionAnchorId(null);
      return;
    }

    if (event.shiftKey && selectionAnchorId) {
      const visibleSelectableIds = sortedNodes
        .filter((candidate) => !candidate.isRoot)
        .map((candidate) => candidate.id);
      const anchorIndex = visibleSelectableIds.indexOf(selectionAnchorId);
      const nodeIndex = visibleSelectableIds.indexOf(node.id);

      if (anchorIndex !== -1 && nodeIndex !== -1) {
        const start = Math.min(anchorIndex, nodeIndex);
        const end = Math.max(anchorIndex, nodeIndex);
        setSelectedNodeIds(visibleSelectableIds.slice(start, end + 1));
        return;
      }
    }

    if (event.ctrlKey || event.metaKey) {
      setSelectedNodeIds((prev) => {
        if (prev.includes(node.id)) {
          return prev.filter((id) => id !== node.id);
        }
        return [...prev, node.id];
      });
      setSelectionAnchorId(node.id);
      return;
    }

    if (event.type === "contextmenu" && selectedNodeIdSet.has(node.id)) {
      return;
    }

    setSelectedNodeIds([node.id]);
    setSelectionAnchorId(node.id);
  };

  const getSessionDataForNode = (node: SessionNode): Parameters<typeof addSession>[0] | null => {
    if (!node.config) {
      return null;
    }

    if (node.type === "ssh" && isSshConfig(node.config)) {
      return { title: node.name, type: "ssh", host: node.config.host, config: { host: node.config.host, port: node.config.port, sshConfig: node.config } };
    }

    if (node.type === "rdp" && isRdpConfig(node.config)) {
      const backend = resolveRdpBackend(useSettingsStore.getState().rdpBackend);
      const rdpConfig = backend === "msrdpax"
        ? { ...node.config, backend, width: undefined, height: undefined, autoResize: true }
        : { ...node.config, backend, autoResize: false };
      return { title: node.name, type: "rdp", host: rdpConfig.host, config: { host: rdpConfig.host, port: rdpConfig.port, rdpConfig } };
    }

    if (node.type === "vnc" && isVncConfig(node.config)) {
      return { title: node.name, type: "vnc", host: node.config.host, config: { host: node.config.host, port: node.config.port, vncConfig: node.config } };
    }

    if (node.type === "serial" && isSerialConfig(node.config)) {
      return { title: node.name, type: "serial", host: node.config.port, config: { serialConfig: node.config } };
    }

    if (node.type === "telnet" && isTelnetConfig(node.config)) {
      return { title: node.name, type: "telnet", host: node.config.host, config: { telnetConfig: node.config } };
    }

    if (node.type === "ai-cli" && node.config) {
      return { title: node.name, type: "ai-cli", config: { aiCliConfig: node.config as AiCliConfig } };
    }

    return null;
  };

  const handleAction = (type: string, node: SessionNode) => {
    if (type === 'connect') {
      const targetNodes = selectedNodeIds.length > 1 && selectedNodeIdSet.has(node.id)
        ? sortedNodes.filter((candidate) => selectedNodeIdSet.has(candidate.id))
        : [node];

      targetNodes
        .map(getSessionDataForNode)
        .filter((sessionData): sessionData is Parameters<typeof addSession>[0] => sessionData !== null)
        .forEach(launchWorkspaceWithSession);
    } else if (type === 'duplicate' && node.type !== 'folder') {
      const siblingNames = new Set(
        nodes.filter((candidate) => candidate.parentId === node.parentId).map((candidate) => candidate.name)
      );
      let duplicateName = t("{name} 副本", { name: node.name });
      let index = 2;
      while (siblingNames.has(duplicateName)) {
        duplicateName = t("{name} 副本 {index}", { name: node.name, index });
        index += 1;
      }
      duplicateProfile(node.id, duplicateName);
    } else if (type === 'new-connection') { setEditNode(null); openDialog('newConnection', node); }
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
    else if (type === 'sftp-download' && node.type === 'ssh') { setSftpNode(node); dialog.open('sftp-download', node.id); }
  };





  return (
    <div className="module-shell">
      <div className="module-header group shrink-0 border-b-0">
        <div className="module-title min-w-0">
          <span className="module-heading truncate text-[15px]">{t("会话")}</span>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          className={cn(
            "h-9 w-9 rounded-2xl border border-input bg-background/72 text-accent-foreground shadow-none transition-colors duration-200",
            "hover:bg-background/88 hover:text-foreground",
            "opacity-80 group-hover:opacity-100"
          )}
          onClick={() => { setInitialQuickConnectType(null); dialog.open('quickConnect'); }}
        >
          <Zap className="h-4 w-4" />
        </Button>
      </div>
      
      <div className="flex-1 overflow-y-auto px-2 pt-0 pb-3">
        <DndContext 
          sensors={sensors} 
          collisionDetection={pointerFirstCollisionDetection}
          onDragStart={(e) => {
            const activatorEvent = e.activatorEvent;
            pointerYRef.current = "clientY" in activatorEvent
              ? (activatorEvent as PointerEvent).clientY
              : null;
            updateDragState(e.active.id as string, null, null);
          }}
          onDragMove={handleDragMove}
          onDragOver={handleDragMove}
          onDragEnd={(e) => {
            const { active, over } = e;
            if (over && active.id !== over.id) {
              const overNode = nodes.find((node) => node.id === over.id);
              const activeRect = active.rect.current.translated ?? active.rect.current.initial;
              const dropPos = overNode
                ? getDropPosition(overNode, pointerYRef.current, activeRect, over.rect)
                : null;
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
                onSelect={handleSelectNode}
                overId={dragState.overId}
                dropPos={dragState.dropPos}
                isSelected={selectedNodeIdSet.has(fn.id)}
                isBulkSelected={selectedNodeIds.length > 1 && selectedNodeIdSet.has(fn.id)}
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

      {/* 快速连接弹窗 */}
      <QuickConnectDialog
        open={dialog.isOpen('quickConnect')}
        onOpenChange={() => { setInitialQuickConnectType(null); dialog.close(); }}
        initialType={initialQuickConnectType as any ?? undefined}
        onConnect={(sessionData) => {
          launchWorkspaceWithSession(sessionData as any);
        }}
      />

      {/* 新建连接统一弹窗 */}
      <NewConnectionDialog
        open={dialog.isOpen('newConnection')}
        onOpenChange={() => dialog.close()}
        onSave={(type, cfg) => {
          const parentId = targetNode?.id ?? "root-folder";
          if (type === "ssh" || type === "rdp" || type === "vnc") {
            void saveRemoteProfile(type, cfg as SSHConfig | RDPConfig | VNCConfig, parentId, null);
            return;
          }
          addProfile(type, cfg, parentId);
          dialog.close();
        }}
      />

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
          void saveRemoteProfile("ssh", cfg, targetNode?.id ?? null, editNode);
        }} 
      />

      {/* RDP 弹窗 */}
      <RdpConnectDialog 
        open={dialog.isOpen('rdp')} 
        onOpenChange={() => dialog.close()} 
        initialConfig={editNode?.type === "rdp" ? editNode.config as RDPConfig : undefined} 
        onSave={(cfg) => {
          void saveRemoteProfile("rdp", cfg, targetNode?.id ?? null, editNode);
        }} 
      />

      {/* VNC 弹窗 */}
      <VncConnectDialog 
        open={dialog.isOpen('vnc')} 
        onOpenChange={() => dialog.close()} 
        initialConfig={editNode?.type === "vnc" ? editNode.config as VNCConfig : undefined} 
        onSave={(cfg) => {
          void saveRemoteProfile("vnc", cfg, targetNode?.id ?? null, editNode);
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

      {/* SFTP 上传弹窗 */}
      <SftpUploadDialog
        open={dialog.isOpen('sftp')}
        onOpenChange={() => dialog.close()}
        targetNode={sftpNode}
      />
      <SftpDownloadDialog
        open={dialog.isOpen('sftp-download')}
        onOpenChange={() => dialog.close()}
        targetNode={sftpNode}
      />

      {/* 删除确认弹窗 */}
      <AlertDialog open={dialog.isOpen('delete')} onOpenChange={() => dialog.close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("确认删除 “{name}”？", { name: deleteTargetName })}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => dialog.close()}>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onClick={() => { 
              if (deleteTargetNodes.length > 0) {
                deleteTargetNodes.forEach((node) => removeNode(node.id));
                setSelectedNodeIds([]);
                setSelectionAnchorId(null);
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
