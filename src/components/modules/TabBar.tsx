import { useTabsStore } from "@/store/tabs";
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
import { X, Plus, Columns } from "lucide-react";
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
import { getAvailableShells } from "@/services/shellService";
import { startTabDrag, endTabDrag } from "@/lib/tab-drag-state";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

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
  return normalizedTitle.includes(normalizedShell) || normalizedTitle === 'terminal';
}

function SortableTab({
  id,
  title,
  active,
  canCloseLeft,
  canCloseRight,
  isSplit,
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
  isSplit?: boolean;
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
            title={title}
            aria-current={active ? "page" : undefined}
            onClick={() => onSwitch(id)}
            onKeyUp={handleKeyUp}
            {...attributes}
            {...listeners}
          >
            <span className="pointer-events-none max-w-48 flex-1 truncate text-[13px] flex items-center justify-center gap-1.5 leading-none">
              {isSplit && <Columns className="h-3.5 w-3.5 opacity-70 shrink-0" />}
              <span className="truncate">{title}</span>
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

  // 不再需要自动化的 Session 生命周期绑定，新建标签时直接分发
  // 仅在组件挂载时如果没有任何 Tab，创建一个默认 Tab
  useEffect(() => {
    if (tabs.length === 0 && shells.length > 0) {
      handleAddTab();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shells]);

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
          : "Terminal";

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
    const previewNames = nonDefaultTabs.slice(0, 3).map((tab) => `“${tab.title}”`);
    const remainingCount = targetCount - previewNames.length;
    const sessionSummary = remainingCount > 0
      ? `${previewNames.join("、")} 等 ${targetCount} 个工作区`
      : previewNames.join("、");

    pendingCloseActionRef.current = onConfirm;
    setCloseConfirmation({
      open: true,
      title: targetCount === 1
        ? `确认关闭 ${previewNames[0]}？`
        : `确认关闭 ${targetCount} 个非默认工作区？`,
      description: `即将关闭 ${sessionSummary}。关闭后相关的连接会立即断开。`,
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

                let displayTitle = tab.title;
                if (isSplit) {
                  const titles = leaves.map(l => sessions.find(s => s.id === l.sessionId)?.title || "新标签");
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
                    onSwitch={handleTabSwitch}
                    onClose={handleCloseTab}
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
                  <span className="pointer-events-none max-w-32 flex-1 truncate text-[13px]">
                    {tabs.find((t) => t.id === activeDragId)?.title || "标签页"}
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