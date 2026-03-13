import { useState, useMemo, useRef, type WheelEvent } from "react";
import { Button } from "@/components/ui/button";
import { Play, Plus, Trash2, Pencil } from "lucide-react";
import { useQuickCommandsStore, type QuickCommand } from "@/store/quick-commands";
import { useTabsStore } from "@/store/tabs";
import type { ITerminalConnector, SessionConnector } from "@/types/terminal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// 可排序的快捷命令按钮组件
function SortableQuickCommand({
  cmd,
  onClick,
  onContextMenu,
  onEdit,
  onDelete,
}: {
  cmd: QuickCommand;
  onClick: () => void;
  onContextMenu: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cmd.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex h-full items-stretch">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="command-card h-full rounded-none px-3 text-xs shadow-none"
            onClick={onClick}
            title={`命令：${cmd.command.split('\n')[0].substring(0, 30)}${cmd.command.length > 30 ? '...' : ''}`}
            disabled={isDragging}
            {...attributes}
            {...listeners}
          >
            <span className="command-card-main">
              <span className="command-card-label">{cmd.label}</span>
            </span>
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-28 text-xs">
          <ContextMenuItem className="py-1 text-xs" onClick={onEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            编辑
          </ContextMenuItem>
          <ContextMenuItem className="py-1 text-xs" onClick={onDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            删除
          </ContextMenuItem>
          <ContextMenuItem className="py-1 text-xs" onClick={onContextMenu}>
            发送到所有标签页
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

export function QuickCmdBar() {
  const { commands, addCommand, removeCommand, updateCommand, reorderCommands } = useQuickCommandsStore();
  const { activeSessionId, sessions, getAllConnectors } = useTabsStore();
  const [configOpen, setConfigOpen] = useState(false);
  const [editingCmd, setEditingCmd] = useState<QuickCommand | null>(null);
  const commandsContainerRef = useRef<HTMLDivElement>(null);

  const restoreTerminalFocus = () => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("lazy-terminal-focus"));
    });
  };

  // 排序命令
  const sortedCommands = useMemo(() => 
    [...commands].sort((a, b) => a.order - b.order),
    [commands]
  );

  // dnd-kit 传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 拖动 8px 后激活
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const isTerminalConnector = (connector: SessionConnector | undefined): connector is ITerminalConnector => {
    return connector !== undefined && connector.protocol !== "rdp";
  };

// 发送命令到当前激活的终端
  const handleCommandClick = (cmd: QuickCommand) => {
    const activeSession = sessions.find((session) => session.id === activeSessionId);
    if (activeSession?.connector?.isConnected && isTerminalConnector(activeSession.connector)) {
      const commandsToExecute = cmd.command.replace(/\r?\n/g, "\r");
      activeSession.connector.write(commandsToExecute);
      restoreTerminalFocus();
    }
  };

  // 发送命令到所有终端会话
  const sendToAllSessions = (cmd: QuickCommand) => {
    const connectors = getAllConnectors();
    if (connectors.length === 0) return;

    const commandsToExecute = cmd.command.replace(/\r?\n/g, "\r");
    connectors.forEach((connector) => {
      if (connector.isConnected) {
        connector.write(commandsToExecute);
      }
    });
    restoreTerminalFocus();
  };

  // 处理拖动结束
  const handleDragEnd = (event: { active: { id: string | number }; over: { id: string | number } | null }) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      // 获取当前排序的命令 ID 列表
      const currentOrder = sortedCommands.map(cmd => cmd.id);
      const oldIndex = currentOrder.indexOf(active.id as string);
      const newIndex = currentOrder.indexOf(over.id as string);
      
      // 重新排序
      const newOrder = arrayMove(currentOrder, oldIndex, newIndex);
      reorderCommands(newOrder);
    }
  };

  // 添加新命令
  const handleAddCommand = (newCommand: Omit<QuickCommand, "id">) => {
    addCommand(newCommand);
  };

  // 编辑命令
  const handleEditCommand = (cmd: QuickCommand) => {
    setEditingCmd(cmd);
    setConfigOpen(true);
  };

  // 删除命令
  const handleDeleteCommand = (cmd: QuickCommand) => {
    removeCommand(cmd.id);
  };

  const handleCommandsWheel = (event: WheelEvent<HTMLDivElement>) => {
    const container = commandsContainerRef.current;
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

  return (
    <div className="quickcmd-surface">
      <div className="quickcmd-leading-icon" aria-label="快捷命令栏" title="快捷命令栏">
        <Play className="h-3 w-3 fill-current" />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedCommands.map(cmd => cmd.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            ref={commandsContainerRef}
            className="toolbar-scroll command-scroll no-scrollbar h-full flex-1"
            onWheel={handleCommandsWheel}
          >
            {sortedCommands.length === 0 ? (
              <div className="flex h-full items-center border border-dashed border-border/70 px-4 text-xs text-muted-foreground">
                暂无快捷命令，点击右侧加号创建常用操作。
              </div>
            ) : (
              sortedCommands.map((cmd) => (
                <SortableQuickCommand
                  key={cmd.id}
                  cmd={cmd}
                  onClick={() => handleCommandClick(cmd)}
                  onContextMenu={() => sendToAllSessions(cmd)}
                  onEdit={() => handleEditCommand(cmd)}
                  onDelete={() => handleDeleteCommand(cmd)}
                />
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>

      {/* 添加命令按钮 */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="quickcmd-add-button h-full rounded-none p-0">
            <Plus className="h-3 w-3" />
          </Button>
        </DialogTrigger>
        
        <DialogContent className="sm:max-w-150">
          <DialogHeader>
            <DialogTitle>{editingCmd ? '编辑快捷命令' : '添加快捷命令'}</DialogTitle>
          </DialogHeader>
          
          <QuickCommandForm 
            onAdd={handleAddCommand}
            onUpdate={updateCommand}
            onClose={() => {
              setConfigOpen(false);
              setEditingCmd(null);
            }}
            editingCmd={editingCmd}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 快捷命令配置表单组件
function QuickCommandForm({
  onAdd,
  onUpdate,
  onClose,
  editingCmd
}: {
  onAdd: (cmd: Omit<QuickCommand, "id">) => void;
  onUpdate: (id: string, updates: Partial<QuickCommand>) => void;
  onClose: () => void;
  editingCmd?: QuickCommand | null;
}) {
  const [label, setLabel] = useState(editingCmd?.label || "");
  const [command, setCommand] = useState(editingCmd?.command || "");
  const [editingId, setEditingId] = useState<string | null>(editingCmd?.id || null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !command) return;
    
    if (editingId) {
      onUpdate(editingId, { 
        label: label.trim(), 
        command: command
      });
      setEditingId(null);
      setLabel("");
      setCommand("");
    } else {
      onAdd({ 
        label: label.trim(), 
        command: command, 
        order: 0,
      });
      setLabel("");
      setCommand("");
    }
  };



  const handleCancel = () => {
    setEditingId(null);
    setLabel("");
    setCommand("");
  };

  return (
    <div className="space-y-4">
      {/* 添加/编辑命令表单 */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="label">名称</Label>
          <Input
            id="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="如：清屏"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="command">命令</Label>
          <Textarea
            id="command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={`输入命令，支持换行&#10;例如：&#10;cd project&#10;npm install&#10;&#10;提示：有几个换行，就会触发几次执行；最后一行没有换行时，只会输入不会执行`}
            rows={6}
          />
        </div>
        
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="flex-1">
            <Plus className="h-4 w-4 mr-1" />
            {editingId ? "更新命令" : "添加命令"}
          </Button>
          {editingId && (
            <Button 
              type="button" 
              variant="outline" 
              size="sm"
              onClick={() => {
                handleCancel();
                onClose();
              }}
            >
              取消
            </Button>
          )}
        </div>
      </form>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );
}