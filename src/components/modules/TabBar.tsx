import { useTabsStore, type TerminalSession } from "@/store/tabs";
import { usePanesStore } from "@/store/panes";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X, Plus, Columns, Pencil, XCircle, ArrowLeftToLine, ArrowRightToLine, Copy, Server, Terminal, AppWindow, ScreenShare, Usb, LayoutTemplate } from "lucide-react";
import { useSettingsStore } from "@/store/settings";
import { getAllLeaves } from "@/lib/pane-utils";
import { useEffect, useRef, useState, useCallback, type KeyboardEvent, type MouseEvent, type PointerEvent, type WheelEvent } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ShellInfo } from "@/types/shell";
import type { SessionConnectionPhase } from "@/types/terminal";
import { getAvailableShells } from "@/services/shellService";
import { startTabDrag, endTabDrag } from "@/lib/tab-drag-state";
import { createPortal, flushSync } from "react-dom";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { WorkspaceTemplateDialog } from "@/components/modules/WorkspaceTemplateDialog";

interface CloseConfirmationState {
  open: boolean;
  title: string;
  description: string;
}

interface RenameState {
  open: boolean;
  sessionId: string | null;
  value: string;
}



function isDefaultConnectionTab(
  tabTitle: string,
  defaultShell: string,
) {
  // 简化的默认标签页判断，如果名字包含 shell 名称则认为是默认的（后续可优化）
  const normalizedTitle = tabTitle.trim().toLowerCase();
  const normalizedShell = defaultShell.trim().toLowerCase();
  return normalizedTitle.includes(normalizedShell) || normalizedTitle === "terminal" || normalizedTitle === "终端";
}

function getTabIcon(type: TerminalSession["type"] | undefined, isSplit?: boolean) {
  if (isSplit) {
    return <Columns className="tab-session-icon opacity-70" />;
  }

  switch (type) {
    case "ssh":
      return <Server className="tab-session-icon text-emerald-600/80" />;
    case "rdp":
      return <AppWindow className="tab-session-icon text-sky-600/80" />;
    case "vnc":
      return <ScreenShare className="tab-session-icon text-emerald-600/80" />;
    case "serial":
      return <Usb className="tab-session-icon text-purple-600/80" />;
    case "telnet":
      return <Terminal className="tab-session-icon text-emerald-500/80" />;
    case "ai-cli":
      return <Terminal className="tab-session-icon text-violet-600/80" />;
    case "local":
      return <Terminal className="tab-session-icon text-blue-600/80" />;
    default:
      return null;
  }
}

function SortableTab({
  id,
  title,
  active,
  canCloseLeft,
  canCloseRight,
  canDuplicate,
  isSplit,
  sessionType,
  connectionPhase,
  onSwitch,
  onClose,
  onDuplicate,
  onSaveAsTemplate,
  onRename,
  onCloseOthers,
  onCloseLeft,
  onCloseRight,
}: {
  id: string;
  title: string;
  active: boolean;
  canCloseLeft: boolean;
  canCloseRight: boolean;
  canDuplicate: boolean;
  sessionType?: TerminalSession["type"];
  connectionPhase?: SessionConnectionPhase;
  onSwitch: (id: string) => void;
  onClose: (event: MouseEvent<HTMLButtonElement>, id: string) => void;
  onDuplicate: (id: string) => void;
  onSaveAsTemplate: (id: string) => void;
  onRename: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseRight: (id: string) => void;
  isSplit?: boolean;
}) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const [contextMenuKey, setContextMenuKey] = useState(0);
  const contextMenuTriggerRef = useRef<HTMLDivElement | null>(null);

  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSwitch(id);
    }
  };

  const handleClosePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const handleContextMenuPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 2) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const { clientX, clientY, screenX, screenY } = event;
    // Recreate the Root synchronously, then open the new trigger directly at
    // this pointer. This avoids Radix batching the old close and new open into
    // one unchanged `open=true` state on repeated right clicks.
    flushSync(() => {
      setContextMenuKey((current) => current + 1);
    });
    contextMenuTriggerRef.current?.dispatchEvent(new window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX,
      clientY,
      screenX,
      screenY,
      view: window,
    }));
  };

  const tabIcon = getTabIcon(sessionType, isSplit);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.7 : 1,
        zIndex: isDragging ? 20 : undefined,
      }}
      className="shrink-0"
    >
      <ContextMenu
        key={contextMenuKey}
        modal={false}
      >
        <ContextMenuTrigger asChild>
          <div
            ref={contextMenuTriggerRef}
            className={`tab-item group relative cursor-pointer select-none ${
              active
                ? "tab-item-active"
                : ""
            } ${isDragging ? "bg-background/90 shadow-lg ring-1 ring-border/70" : ""}`}
            title={title}
            aria-current={active ? "page" : undefined}
            onClick={() => onSwitch(id)}
            onKeyUp={handleKeyUp}
            {...attributes}
            {...listeners}
            onPointerDownCapture={handleContextMenuPointerDownCapture}
          >
            <span className="pointer-events-none min-w-0 truncate text-[13px] flex items-center justify-center gap-1.5 leading-5">
              {tabIcon}
              {connectionPhase && (
                <span className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  connectionPhase === "connected" ? "bg-emerald-400" :
                    connectionPhase === "failed" ? "bg-red-400" :
                      connectionPhase === "disconnected" ? "bg-amber-400" :
                        connectionPhase === "closing" || connectionPhase === "idle" ? "bg-muted-foreground/50" : "bg-sky-400 animate-pulse",
                )} />
              )}
              <span className="min-w-0 truncate">{title}</span>
            </span>

            <Button
              variant="ghost"
              size="icon"
              className={`tab-close h-4! w-4! min-w-0! p-0! text-muted-foreground transition-all hover:bg-background/40 hover:text-foreground ${
                active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
              onPointerDown={handleClosePointerDown}
              onClick={(event) => onClose(event, id)}
              aria-label={t("关闭 {title}", { title })}
            >
              <X className="h-2 w-2" />
            </Button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-40 text-xs">
          <ContextMenuItem className="py-1 text-xs" disabled={!canDuplicate} onClick={() => onDuplicate(id)}>
            <Copy className="mr-2 h-3.5 w-3.5" />
            {t("复制会话")}
          </ContextMenuItem>
          {isSplit ? (
            <ContextMenuItem className="py-1 text-xs" onClick={() => onSaveAsTemplate(id)}>
              <LayoutTemplate className="mr-2 h-3.5 w-3.5" />
              {t("保存为工作区")}
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem className="py-1 text-xs" onClick={() => onRename(id)}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            {t("重命名标签页")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="py-1 text-xs" onClick={() => onCloseOthers(id)}>
            <XCircle className="mr-2 h-3.5 w-3.5" />
            {t("关闭其他")}
          </ContextMenuItem>
          <ContextMenuItem className="py-1 text-xs" disabled={!canCloseLeft} onClick={() => onCloseLeft(id)}>
            <ArrowLeftToLine className="mr-2 h-3.5 w-3.5" />
            {t("关闭左侧")}
          </ContextMenuItem>
          <ContextMenuItem className="py-1 text-xs" disabled={!canCloseRight} onClick={() => onCloseRight(id)}>
            <ArrowRightToLine className="mr-2 h-3.5 w-3.5" />
            {t("关闭右侧")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

export function TabBar() {
  const { locale, t } = useI18n();
  const {
    tabs,
    sessions,
    activeTabId,
    setActiveTabId,
    addTab,
    removeTab,
    reorderTabs,
    updateTab,
    addSession,
    removeSession,
  } = useTabsStore();
  
  const {
    workspaces,
    cleanupWorkspace,
  } = usePanesStore();

  const { defaultShell, confirmCloseNonDefaultTabs } = useSettingsStore();
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [closeConfirmation, setCloseConfirmation] = useState<CloseConfirmationState>({
    open: false,
    title: "",
    description: "",
  });
  const [renameState, setRenameState] = useState<RenameState>({
    open: false,
    sessionId: null,
    value: "",
  });
  const [workspaceTemplateDialogOpen, setWorkspaceTemplateDialogOpen] = useState(false);
  const [templateWorkspaceId, setTemplateWorkspaceId] = useState<string | null>(null);
  
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [isTabsOverflowing, setIsTabsOverflowing] = useState(false);
  const pendingCloseActionRef = useRef<(() => void) | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getAvailableShells()
      .then(setShells)
      .catch((err) => logger.error("FE/tab-bar", "Failed to get shells", {err}));
  }, []);

  // 启动时不自动创建默认 Tab，由用户手动新建或从会话列表连接

  useEffect(() => {
    if (!renameState.open) {
      return;
    }

    const input = renameInputRef.current;
    if (!input) {
      return;
    }

    const timer = window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [renameState.open]);

  useEffect(() => {
    const updateTabsOverflow = () => {
      const container = tabsContainerRef.current;
      if (!container) {
        return;
      }

      const nextOverflow = container.scrollWidth > container.clientWidth + 1;
      setIsTabsOverflowing((current) => (current === nextOverflow ? current : nextOverflow));
    };

    const frame = window.requestAnimationFrame(updateTabsOverflow);
    const container = tabsContainerRef.current;

    if (!container || typeof ResizeObserver === "undefined") {
      return () => window.cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(() => {
      updateTabsOverflow();
    });

    observer.observe(container);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [tabs, isTabsOverflowing]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const draggedId = String(event.active.id);
    // 通知 PaneView：有标签页开始拖拽
    startTabDrag(draggedId);
    setActiveDragId(draggedId);

    // 用户需求：如果拖拽的是当前激活的 Tab，自动将视图切换到相邻的 Tab，方便将被拖拽的 Tab 放到别的分屏里
    const { activeTabId, tabs, setActiveTabId } = useTabsStore.getState();
    if (draggedId === activeTabId && tabs.length > 1) {
      const currentIndex = tabs.findIndex((t) => t.id === draggedId);
      if (currentIndex > 0) {
        setActiveTabId(tabs[currentIndex - 1].id);
      } else {
        setActiveTabId(tabs[currentIndex + 1].id);
      }
      
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("lazy-term-focus"));
      });
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    // 通知 PaneView：拖拽结束
    endTabDrag();
    setActiveDragId(null);

    const { active, over } = event;
    // 如果拖拽在排序区域内结束 → 重排列
    if (over && active.id !== over.id) {
      const currentOrder = tabs.map((tab) => tab.id);
      const oldIndex = currentOrder.indexOf(String(active.id));
      const newIndex = currentOrder.indexOf(String(over.id));
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderTabs(arrayMove(currentOrder, oldIndex, newIndex));
      }
    }
    // 如果 over === null，拖拽到了排序区域外
    // PaneView 会通过 TAB_DRAG_END_EVENT 自行处理
  }, [tabs, reorderTabs]);

  const handleAddTab = () => {
    const shellInfo = shells.find(
      (shell) => shell.path === defaultShell || shell.name.toLowerCase() === defaultShell.toLowerCase()
    );
    const title = shellInfo
      ? shellInfo.name
      : defaultShell.includes("powershell")
        ? "PowerShell"
          : defaultShell.includes("cmd")
            ? "CMD"
            : defaultShell.includes("wsl")
              ? "WSL"
            : t("终端");

    // 创建新会话 - pane 的创建和关联由生命周期回调自动处理
    logger.debug("FE/TabBar", "Creating new workspace and session", { title });
    
    // 1. 创建工作区 Tab
    const tabId = addTab({ title });
    setActiveTabId(tabId);

    // 2. 创建主会话
    const sessionId = addSession({
      title,
      type: "local",
      cwd: typeof process !== "undefined" ? process.cwd() : "/",
      config: {
        shell: defaultShell,
      },
    });

    // 3. 将会话放入刚才选中的工作区
    usePanesStore.getState().addPane(sessionId);
  };

  const syncFocusSession = (tabId: string) => {
    const ws = workspaces[tabId];
    if (ws && ws.focusedPaneId) {
      const leaves = ws.rootNode ? getAllLeaves(ws.rootNode) : [];
      const focusedLeaf = leaves.find(l => l.id === ws.focusedPaneId) || leaves[0];
      if (focusedLeaf?.sessionId) {
        useTabsStore.getState().setFocusSession(focusedLeaf.sessionId);
      }
    }
  };

  const handleTabSwitch = (id: string) => {
    setActiveTabId(id);
    syncFocusSession(id);
    
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("lazy-term-focus"));
    });
  };
  
  const requestCloseConfirmation = (targetIds: string[], onConfirm: () => void) => {
    if (targetIds.length === 0) {
      return;
    }

    const targetIdSet = new Set(targetIds);
    const targetTabs = tabs.filter((tab) => targetIdSet.has(tab.id));
    const nonDefaultTabs = targetTabs.filter(
      (tab) => !isDefaultConnectionTab(tab.title, defaultShell)
    );

    if (!confirmCloseNonDefaultTabs || nonDefaultTabs.length === 0) {
      onConfirm();
      return;
    }

    const targetCount = nonDefaultTabs.length;
    const previewNames = nonDefaultTabs.slice(0, 3).map((tab) =>
      locale === "zh-CN" ? `“${tab.title}”` : `"${tab.title}"`,
    );
    const remainingCount = targetCount - previewNames.length;
    const sessionSummary = remainingCount > 0
      ? `${previewNames.join(locale === "zh-CN" ? "、" : ", ")} ${t("等 {count} 个工作区", { count: targetCount })}`
      : previewNames.join(locale === "zh-CN" ? "、" : ", ");

    pendingCloseActionRef.current = onConfirm;
    setCloseConfirmation({
      open: true,
      title: targetCount === 1
        ? t("确认关闭 {name}？", { name: previewNames[0] })
        : t("确认关闭 {count} 个非默认工作区？", { count: targetCount }),
      description: t("将关闭 {summary}，相关连接会立即断开。", { summary: sessionSummary }),
    });
  };

  const handleCloseDialogChange = (open: boolean) => {
    if (open) {
      setCloseConfirmation((state) => ({ ...state, open: true }));
      return;
    }

    pendingCloseActionRef.current = null;
    setCloseConfirmation((state) => ({ ...state, open: false }));
  };

  const handleConfirmClose = () => {
    const pendingAction = pendingCloseActionRef.current;
    pendingCloseActionRef.current = null;
    setCloseConfirmation((state) => ({ ...state, open: false }));
    pendingAction?.();
  };

  const _closeWorkspace = (tabId: string) => {
    // 找出所有关联的 session，关闭它们
    const leaves = usePanesStore.getState().getAllLeaves(tabId);
    leaves.forEach(l => {
      if (l.sessionId) removeSession(l.sessionId);
    });
    // 清理并在 TabBar 中移除
    cleanupWorkspace(tabId);
    removeTab(tabId);
  }

  const handleCloseTab = (event: MouseEvent<HTMLButtonElement>, id: string) => {
    event.stopPropagation();
    requestCloseConfirmation([id], () => _closeWorkspace(id));
  };

  const handleCloseOthers = (id: string) => {
    const targetIds = tabs.filter((tab) => tab.id !== id).map((tab) => tab.id);
    requestCloseConfirmation(
      targetIds,
      () => {
        targetIds.forEach(_closeWorkspace);
      }
    );
  };

  const handleCloseLeft = (id: string) => {
    const targetIndex = tabs.findIndex((tab) => tab.id === id);
    if (targetIndex <= 0) {
      return;
    }

    const targetIds = tabs.slice(0, targetIndex).map((tab) => tab.id);
    requestCloseConfirmation(
      targetIds,
      () => {
        targetIds.forEach(_closeWorkspace);
      }
    );
  };

  const handleCloseRight = (id: string) => {
    const targetIndex = tabs.findIndex((tab) => tab.id === id);
    if (targetIndex === -1 || targetIndex >= tabs.length - 1) {
      return;
    }

    const targetIds = tabs.slice(targetIndex + 1).map((tab) => tab.id);
    requestCloseConfirmation(
      targetIds,
      () => {
        targetIds.forEach(_closeWorkspace);
      }
    );
  };

  const cloneSessionConfig = <T,>(value: T): T => {
    if (value === undefined || value === null) {
      return value;
    }

    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
  };

  const handleDuplicateSession = (id: string) => {
    const sourceTab = tabs.find((tab) => tab.id === id);
    const leaves = usePanesStore.getState().getAllLeaves(id);

    if (!sourceTab || leaves.length !== 1 || !leaves[0]?.sessionId) {
      return;
    }

    const sourceSession = useTabsStore.getState().sessions.find((session) => session.id === leaves[0].sessionId);
    if (!sourceSession) {
      return;
    }

    const tabId = addTab({ title: sourceTab.title });
    setActiveTabId(tabId);

    const sessionId = addSession({
      title: sourceSession.title,
      type: sourceSession.type,
      cwd: sourceSession.cwd,
      host: sourceSession.host,
      config: cloneSessionConfig(sourceSession.config),
    });

    usePanesStore.getState().addPane(sessionId);
  };

  const handleRenameOpen = (id: string) => {
    const session = tabs.find((tab) => tab.id === id);
    if (!session) {
      return;
    }

    setRenameState({
      open: true,
      sessionId: id,
      value: session.title,
    });
  };

  const handleRenameDialogChange = (open: boolean) => {
    setRenameState((state) => open
      ? { ...state, open: true }
      : { open: false, sessionId: null, value: "" }
    );
  };

  const handleRenameSubmit = () => {
    const nextTitle = renameState.value.trim();
    if (!renameState.sessionId || !nextTitle) {
      return;
    }

    updateTab(renameState.sessionId, { title: nextTitle });
    setRenameState({ open: false, sessionId: null, value: "" });
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRenameSubmit();
    }
  };

  const handleOpenWorkspaceTemplates = (tabId: string | null = activeTabId) => {
    if (tabId) {
      setActiveTabId(tabId);
    }
    setTemplateWorkspaceId(tabId);
    setWorkspaceTemplateDialogOpen(true);
  };




  const handleTabsWheel = (event: WheelEvent<HTMLDivElement>) => {
    const container = tabsContainerRef.current;
    if (!container || container.scrollWidth <= container.clientWidth) {
      return;
    }

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;

    if (delta === 0) {
      return;
    }

    container.scrollLeft += delta;
    event.preventDefault();
  };

  const addTabButton = (
    <Button
      variant="ghost"
      size="icon"
      className="tabbar-add-button h-11! w-11! rounded-none! hover:bg-transparent! [&_svg]:size-5!"
      onClick={handleAddTab}
      aria-label={t("新增标签页")}
    >
      <Plus />
    </Button>
  );

  return (
    <div className="tabbar-surface">
      <div className="min-w-0 flex-1 overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div
              ref={tabsContainerRef}
              className="tabbar-scroll no-scrollbar"
              onWheel={handleTabsWheel}
            >
              {tabs.map((tab) => {
                const ws = workspaces[tab.id];
                const leaves = ws?.rootNode ? getAllLeaves(ws.rootNode) : [];
                const isSplit = leaves.length > 1;
                const canDuplicate = leaves.length === 1 && !!leaves[0]?.sessionId;
                const singleSession = !isSplit && leaves[0]?.sessionId
                  ? sessions.find((session) => session.id === leaves[0].sessionId)
                  : undefined;
                const tabSessions = leaves
                  .map((leaf) => sessions.find((session) => session.id === leaf.sessionId))
                  .filter((session): session is TerminalSession => Boolean(session));
                const connectionPhase = tabSessions.find((session) => session.connectionStatus.phase === "failed")?.connectionStatus.phase
                  ?? tabSessions.find((session) => session.connectionStatus.phase === "disconnected")?.connectionStatus.phase
                  ?? tabSessions.find((session) => ["connecting", "authenticating", "reconnecting"].includes(session.connectionStatus.phase))?.connectionStatus.phase
                  ?? tabSessions[0]?.connectionStatus.phase;

                let displayTitle = tab.title;
                if (isSplit) {
                  const titles = leaves.map(l => sessions.find(s => s.id === l.sessionId)?.title || t("新标签"));
                  displayTitle = titles.join(" | ");
                }

                return (
                  <SortableTab
                    key={tab.id}
                    id={tab.id}
                    title={displayTitle}
                    isSplit={isSplit}
                    active={activeTabId === tab.id}
                    canCloseLeft={tabs[0]?.id !== tab.id}
                    canCloseRight={tabs[tabs.length - 1]?.id !== tab.id}
                    canDuplicate={canDuplicate}
                    sessionType={singleSession?.type}
                    connectionPhase={connectionPhase}
                    onSwitch={handleTabSwitch}
                    onClose={handleCloseTab}
                    onDuplicate={handleDuplicateSession}
                    onSaveAsTemplate={handleOpenWorkspaceTemplates}
                    onRename={handleRenameOpen}
                    onCloseOthers={handleCloseOthers}
                    onCloseLeft={handleCloseLeft}
                    onCloseRight={handleCloseRight}
                  />
                );
              })}

              {!isTabsOverflowing ? (
                <div className="tabbar-action tabbar-action-inline relative z-10 shrink-0">
                  {addTabButton}
                </div>
              ) : null}
            </div>
          </SortableContext>
          {typeof document !== "undefined" && createPortal(
            <DragOverlay zIndex={9999} dropAnimation={null}>
              {activeDragId ? (
                <div
                  className={cn(
                    "tab-item group relative cursor-pointer select-none",
                    "bg-background/90 shadow-2xl ring-1 ring-border/70 shrink-0",
                    "tab-item-active z-[9999] opacity-90 backdrop-blur-xl"
                  )}
                  style={{ width: "180px", cursor: "grabbing" }}
                >
                  <span className="pointer-events-none max-w-32 flex-1 truncate text-[13px] leading-5">
                    {tabs.find((t) => t.id === activeDragId)?.title || t("标签")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="tab-close ml-1 text-muted-foreground opacity-100"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </DragOverlay>,
            document.body
          )}
        </DndContext>
      </div>

      {isTabsOverflowing ? (
        <div className="tabbar-action relative z-10">
          {addTabButton}
        </div>
      ) : null}
      
      <AlertDialog open={closeConfirmation.open} onOpenChange={handleCloseDialogChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{closeConfirmation.title}</AlertDialogTitle>
            <AlertDialogDescription>{closeConfirmation.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>{t("确认关闭")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={renameState.open} onOpenChange={handleRenameDialogChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("重命名标签页")}</DialogTitle>
            <DialogDescription>{t("修改当前标签页显示名称。")}</DialogDescription>
          </DialogHeader>
          <Input
            ref={renameInputRef}
            value={renameState.value}
            onChange={(event) => setRenameState((state) => ({ ...state, value: event.target.value }))}
            onKeyDown={handleRenameKeyDown}
            maxLength={80}
            placeholder={t("输入标签页名称")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => handleRenameDialogChange(false)}>
              {t("取消")}
            </Button>
            <Button onClick={handleRenameSubmit} disabled={!renameState.value.trim()}>
              {t("保存")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WorkspaceTemplateDialog
        open={workspaceTemplateDialogOpen}
        workspaceId={templateWorkspaceId}
        onOpenChange={(open) => {
          setWorkspaceTemplateDialogOpen(open);
          if (!open) {
            setTemplateWorkspaceId(null);
          }
        }}
      />
    </div>
  );
}
