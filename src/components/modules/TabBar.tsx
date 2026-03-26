import { useTabsStore, registerSessionLifecycleCallbacks, unregisterSessionLifecycleCallbacks } from "@/store/tabs";
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
import { X, Plus } from "lucide-react";
import { useSettingsStore } from "@/store/settings";
import { useEffect, useRef, useState, useCallback, type KeyboardEvent, type MouseEvent, type PointerEvent, type WheelEvent } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
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
import { getAvailableShells } from "@/services/shellService";

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

function normalizeShellValue(value: string) {
  return value.trim().toLowerCase();
}

function isDefaultConnectionTab(
  session: ReturnType<typeof useTabsStore.getState>["sessions"][number],
  defaultShell: string,
) {
  if (session.type !== "local") {
    return false;
  }

  if (session.config?.sshConfig || session.config?.admin) {
    return false;
  }

  const sessionShell = session.config?.shell;
  if (!sessionShell) {
    return true;
  }

  return normalizeShellValue(sessionShell) === normalizeShellValue(defaultShell);
}

function SortableTab({
  id,
  title,
  active,
  canCloseLeft,
  canCloseRight,
  onSwitch,
  onClose,
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
  onSwitch: (id: string) => void;
  onClose: (event: MouseEvent<HTMLButtonElement>, id: string) => void;
  onRename: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseRight: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSwitch(id);
    }
  };

  const handleClosePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

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
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`tab-item group relative cursor-pointer select-none ${
              active
                ? "tab-item-active"
                : ""
            } ${isDragging ? "bg-background/90 shadow-lg ring-1 ring-border/70" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => onSwitch(id)}
            onKeyUp={handleKeyUp}
            {...attributes}
            {...listeners}
          >
            <span className="pointer-events-none max-w-32 flex-1 truncate text-[13px]">
              {title}
            </span>

            <Button
              variant="ghost"
              size="icon"
              className={`tab-close ml-1 text-muted-foreground transition-all hover:bg-background/40 hover:text-foreground ${
                active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
              onPointerDown={handleClosePointerDown}
              onClick={(event) => onClose(event, id)}
              aria-label={`关闭 ${title}`}
            >
              <X className="h-2 w-2" />
            </Button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-32 text-xs">
          <ContextMenuItem className="py-1 text-xs" onClick={() => onRename(id)}>
            重命名标签页
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="py-1 text-xs" onClick={() => onCloseOthers(id)}>
            关闭其他标签页
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="py-1 text-xs" disabled={!canCloseLeft} onClick={() => onCloseLeft(id)}>
            关闭左侧标签页
          </ContextMenuItem>
          <ContextMenuItem className="py-1 text-xs" disabled={!canCloseRight} onClick={() => onCloseRight(id)}>
            关闭右侧标签页
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

export function TabBar() {
  const {
    sessions: tabs,
    focusSessionId: activeTabId,
    setFocusSession,
    removeSession,
    addSession,
    reorderSessions,
    closeOtherSessions,
    closeLeftSessions,
    closeRightSessions,
    updateSession,
  } = useTabsStore();
  
  const {
    focusedPaneId,
    setPaneSession,
    focusPane,
    canSplit,
    splitPane,
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
  const [isTabsOverflowing, setIsTabsOverflowing] = useState(false);
  const pendingCloseActionRef = useRef<(() => void) | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getAvailableShells()
      .then(setShells)
      .catch((err) => logger.error("FE/tab-bar", "Failed to get shells", {err}));
  }, []);

  /**
   * 激活会话（将 session 绑定到 pane）
   * 当会话变为活动会话时调用（新建会话、切换会话）
   * 
   * 逻辑：
   * - 如果没有 pane，新建 pane 并绑定
   * - 如果有焦点 pane，绑定到焦点 pane
   * - 如果有 pane 但没有焦点，绑定到第一个 pane
   */
  const activateSession = useCallback((sessionId: string) => {
    const panesStore = usePanesStore.getState();
    const { panes, focusedPaneId } = panesStore;
    
    logger.debug("FE/TabBar", "Activating session", { sessionId, panesCount: panes.length, focusedPaneId });
    
    if (panes.length === 0) {
      // 没有 pane，创建新 pane 并关联
      const newPaneId = panesStore.addPane(sessionId);
      logger.debug("FE/TabBar", "Created new pane for session", { sessionId, newPaneId });
    } else if (focusedPaneId) {
      // 有焦点 pane，绑定到焦点 pane
      panesStore.setPaneSession(focusedPaneId, sessionId);
      logger.debug("FE/TabBar", "Bound session to focused pane", { focusedPaneId, sessionId });
    } else {
      // 有 pane 但没有焦点，绑定到第一个 pane
      const firstPane = panes[0];
      panesStore.setPaneSession(firstPane.id, sessionId);
      panesStore.focusPane(firstPane.id);
      logger.debug("FE/TabBar", "Bound session to first pane", { paneId: firstPane.id, sessionId });
    }
  }, []);

  /**
   * 将会话设为焦点
   * 当会话变为 focus session 时调用（切换 tab、关闭其他 tab）
   * 
   * 逻辑：
   * - 如果目标 session 已在某个 pane 中，将焦点设到该 pane
   * - 如果只有 1 个 pane，直接替换 pane 中的 session
   * - 如果多个 pane 且目标 session 未显示，在当前焦点 pane 中显示
   */
  const focusSession = useCallback((sessionId: string) => {
    const panesStore = usePanesStore.getState();
    const { panes, focusedPaneId } = panesStore;
    
    logger.debug("FE/TabBar", "Focusing session", { sessionId, panesCount: panes.length });
    
    // 查找目标 session 是否已经在某个 pane 中显示
    const targetPane = panesStore.getPaneBySession(sessionId);
    if (targetPane) {
      // 目标 session 已经在某个 pane 中，将焦点设到该 pane
      panesStore.focusPane(targetPane.id);
      logger.debug("FE/TabBar", "Focused to pane with session", { paneId: targetPane.id, sessionId });
    } else if (panes.length === 1) {
      // 只有 1 个 pane，直接替换 session
      panesStore.setPaneSession(panes[0].id, sessionId);
      panesStore.focusPane(panes[0].id);
      logger.debug("FE/TabBar", "Replaced single pane session", { paneId: panes[0].id, sessionId });
    } else if (focusedPaneId) {
      // 多个 pane，在当前焦点 pane 中显示
      panesStore.setPaneSession(focusedPaneId, sessionId);
      logger.debug("FE/TabBar", "Set session to focused pane", { paneId: focusedPaneId, sessionId });
    }
  }, []);

  /**
   * 移除会话（关闭 session 时调用）
   * 直接删除对应的 pane
   */
  const removeSessionPane = useCallback((sessionId: string) => {
    const panesStore = usePanesStore.getState();
    
    logger.debug("FE/TabBar", "Removing pane for session", { sessionId });
    
    const pane = panesStore.getPaneBySession(sessionId);
    if (pane) {
      panesStore.removePane(pane.id);
      logger.debug("FE/TabBar", "Removed pane", { paneId: pane.id, sessionId });
    }
  }, []);

  // 注册 session 生命周期回调
  const handleSessionCreated = useCallback((sessionId: string) => {
    activateSession(sessionId);
  }, [activateSession]);

  const handleSessionRemoved = useCallback((sessionId: string) => {
    removeSessionPane(sessionId);
  }, [removeSessionPane]);

  const handleFocusSessionChanged = useCallback((sessionId: string) => {
    // 关闭会话后焦点切换到其他会话，需要重新绑定 pane
    logger.debug("FE/TabBar", "Focus session changed, activating", { sessionId });
    activateSession(sessionId);
  }, [activateSession]);

  const handleAllSessionsClosed = useCallback(() => {
    logger.debug("FE/TabBar", "All sessions closed, clearing panes");
    usePanesStore.getState().clearPanes();
  }, []);

  useEffect(() => {
    const callbacks = {
      onSessionCreated: handleSessionCreated,
      onSessionRemoved: handleSessionRemoved,
      onFocusSessionChanged: handleFocusSessionChanged,
      onAllSessionsClosed: handleAllSessionsClosed,
    };

    registerSessionLifecycleCallbacks(callbacks);
    logger.debug("FE/TabBar", "Session lifecycle callbacks registered");

    return () => {
      unregisterSessionLifecycleCallbacks();
      logger.debug("FE/TabBar", "Session lifecycle callbacks unregistered");
    };
  }, [handleSessionCreated, handleSessionRemoved, handleFocusSessionChanged, handleAllSessionsClosed]);

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
          : "Terminal";

    // 创建新会话 - pane 的创建和关联由生命周期回调自动处理
    logger.debug("FE/TabBar", "Creating new session", { title });
    addSession({
      title,
      type: "local",
      cwd: typeof process !== "undefined" ? process.cwd() : "/",
      config: {
        shell: defaultShell,
      },
    });
  };

  const handleTabSwitch = (id: string, paneId?: string) => {
    setFocusSession(id);
    
    // 使用 focusSession 处理 pane 绑定和焦点切换
    if (paneId) {
      // 指定了 paneId，直接切换到该 pane
      setPaneSession(paneId, id);
      focusPane(paneId);
    } else {
      focusSession(id);
    }
    
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("lazy-terminal-focus"));
    });
  };
  
  // 处理在当前面板打开会话
  const handleOpenInCurrentPane = (sessionId: string) => {
    setFocusSession(sessionId);
    activateSession(sessionId);
  };
  
  // 处理在新面板打开会话
  const handleOpenInNewPane = (sessionId: string) => {
    if (!canSplit()) {
      // 如果不能分屏，在当前面板打开
      handleOpenInCurrentPane(sessionId);
      return;
    }
    
    if (focusedPaneId) {
      // 拆分当前面板
      const newPaneId = splitPane(focusedPaneId, "horizontal", sessionId);
      if (newPaneId) {
        setFocusSession(sessionId);
      }
    }
  };
  
  const requestCloseConfirmation = (targetIds: string[], onConfirm: () => void) => {
    if (targetIds.length === 0) {
      return;
    }

    const targetIdSet = new Set(targetIds);
    const targetSessions = tabs.filter((tab) => targetIdSet.has(tab.id));
    const nonDefaultSessions = targetSessions.filter(
      (session) => !isDefaultConnectionTab(session, defaultShell)
    );

    if (!confirmCloseNonDefaultTabs || nonDefaultSessions.length === 0) {
      onConfirm();
      return;
    }

    const targetCount = nonDefaultSessions.length;
    const previewNames = nonDefaultSessions.slice(0, 3).map((session) => `“${session.title}”`);
    const remainingCount = targetCount - previewNames.length;
    const sessionSummary = remainingCount > 0
      ? `${previewNames.join("、")} 等 ${targetCount} 个标签页`
      : previewNames.join("、");

    pendingCloseActionRef.current = onConfirm;
    setCloseConfirmation({
      open: true,
      title: targetCount === 1
        ? `确认关闭 ${previewNames[0]}？`
        : `确认关闭 ${targetCount} 个非默认连接标签页？`,
      description: `即将关闭 ${sessionSummary}。这些标签页不是默认连接，关闭后当前会话会立即断开。`,
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

  const handleCloseTab = (event: MouseEvent<HTMLButtonElement>, id: string) => {
    event.stopPropagation();
    requestCloseConfirmation([id], () => removeSession(id));
  };

  const handleCloseOthers = (id: string) => {
    requestCloseConfirmation(
      tabs.filter((tab) => tab.id !== id).map((tab) => tab.id),
      () => closeOtherSessions(id)
    );
  };

  const handleCloseLeft = (id: string) => {
    const targetIndex = tabs.findIndex((tab) => tab.id === id);
    if (targetIndex <= 0) {
      return;
    }

    requestCloseConfirmation(
      tabs.slice(0, targetIndex).map((tab) => tab.id),
      () => closeLeftSessions(id)
    );
  };

  const handleCloseRight = (id: string) => {
    const targetIndex = tabs.findIndex((tab) => tab.id === id);
    if (targetIndex === -1 || targetIndex >= tabs.length - 1) {
      return;
    }

    requestCloseConfirmation(
      tabs.slice(targetIndex + 1).map((tab) => tab.id),
      () => closeRightSessions(id)
    );
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

    updateSession(renameState.sessionId, { title: nextTitle });
    setRenameState({ open: false, sessionId: null, value: "" });
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRenameSubmit();
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const currentOrder = tabs.map((tab) => tab.id);
    const oldIndex = currentOrder.indexOf(String(active.id));
    const newIndex = currentOrder.indexOf(String(over.id));

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    reorderSessions(arrayMove(currentOrder, oldIndex, newIndex));
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
      aria-label="新增标签页"
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
              {tabs.map((tab) => (
                <SortableTab
                  key={tab.id}
                  id={tab.id}
                  title={tab.title}
                  active={tab.id === activeTabId}
                  canCloseLeft={tabs[0]?.id !== tab.id}
                  canCloseRight={tabs[tabs.length - 1]?.id !== tab.id}
                  onSwitch={handleTabSwitch}
                  onClose={handleCloseTab}
                  onRename={handleRenameOpen}
                  onCloseOthers={handleCloseOthers}
                  onCloseLeft={handleCloseLeft}
                  onCloseRight={handleCloseRight}
                />
              ))}

              {!isTabsOverflowing ? (
                <div className="tabbar-action tabbar-action-inline relative z-10 shrink-0">
                  {addTabButton}
                </div>
              ) : null}
            </div>
          </SortableContext>
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
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>确认关闭</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={renameState.open} onOpenChange={handleRenameDialogChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>重命名标签页</DialogTitle>
            <DialogDescription>修改当前标签页显示名称。</DialogDescription>
          </DialogHeader>
          <Input
            ref={renameInputRef}
            value={renameState.value}
            onChange={(event) => setRenameState((state) => ({ ...state, value: event.target.value }))}
            onKeyDown={handleRenameKeyDown}
            maxLength={80}
            placeholder="输入标签页名称"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => handleRenameDialogChange(false)}>
              取消
            </Button>
            <Button onClick={handleRenameSubmit} disabled={!renameState.value.trim()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}