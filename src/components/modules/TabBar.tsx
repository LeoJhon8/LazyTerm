import { useTabsStore } from "@/store/tabs";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
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
import { X, Plus } from "lucide-react";
import { useSettingsStore } from "@/store/settings";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
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

interface ShellInfo {
  name: string;
  path: string;
  icon_type: string;
}

interface CloseConfirmationState {
  open: boolean;
  title: string;
  description: string;
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
        <ContextMenuContent className="min-w-28 text-xs">
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
    activeSessionId: activeTabId,
    setActiveSession,
    removeSession,
    addSession,
    reorderSessions,
    closeOtherSessions,
    closeLeftSessions,
    closeRightSessions,
  } = useTabsStore();

  const { defaultShell, confirmCloseNonDefaultTabs } = useSettingsStore();
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [closeConfirmation, setCloseConfirmation] = useState<CloseConfirmationState>({
    open: false,
    title: "",
    description: "",
  });
  const pendingCloseActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    invoke<ShellInfo[]>("get_available_shells")
      .then(setShells)
      .catch((err) => logger.error("FE/tab-bar", "Failed to get shells", {err}));
  }, []);

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

    addSession({
      title,
      type: "local",
      cwd: typeof process !== "undefined" ? process.cwd() : "/",
      config: {
        shell: defaultShell,
      },
    });
  };

  const handleTabSwitch = (id: string) => {
    setActiveSession(id);
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("lazy-terminal-focus"));
    });
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
            <div className="tabbar-scroll no-scrollbar">
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
                  onCloseOthers={handleCloseOthers}
                  onCloseLeft={handleCloseLeft}
                  onCloseRight={handleCloseRight}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="tabbar-action relative z-10">
        <Button
          variant="ghost"
          size="icon"
          className="tabbar-add-button h-11! w-11! rounded-none! hover:bg-transparent! [&_svg]:size-5!"
          onClick={handleAddTab}
          aria-label="新增标签页"
        >
          <Plus />
        </Button>
      </div>

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
    </div>
  );
}