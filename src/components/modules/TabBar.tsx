import { useTabsStore } from "@/store/tabs";
import { Button } from "@/components/ui/button";
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
import { useEffect, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
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
            className={`h-8 px-3 relative group flex items-center min-w-20 max-w-52 cursor-pointer rounded-md border border-transparent transition-colors text-sm font-medium select-none ${
              active
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            } ${isDragging ? "shadow-sm ring-1 ring-border bg-background/90" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => onSwitch(id)}
            onKeyUp={handleKeyUp}
            {...attributes}
            {...listeners}
          >
            <span className="text-xs truncate max-w-32 pointer-events-none">
              {title}
            </span>

            <Button
              variant="ghost"
              size="icon"
              className={`h-4 w-4 ml-1 transition-opacity hover:bg-destructive hover:text-destructive-foreground ${
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

  const { defaultShell } = useSettingsStore();
  const [shells, setShells] = useState<ShellInfo[]>([]);

  useEffect(() => {
    invoke<ShellInfo[]>("get_available_shells")
      .then(setShells)
      .catch(console.error);
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

  const handleCloseTab = (event: MouseEvent<HTMLButtonElement>, id: string) => {
    event.stopPropagation();
    removeSession(id);
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
    <div className="h-full flex items-center gap-2 px-2 min-w-0">
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
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pr-1">
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
                  onCloseOthers={closeOtherSessions}
                  onCloseLeft={closeLeftSessions}
                  onCloseRight={closeRightSessions}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="relative z-10 shrink-0 pl-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 bg-background/60 supports-backdrop-filter:backdrop-blur-sm"
          onClick={handleAddTab}
          aria-label="新增标签页"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}