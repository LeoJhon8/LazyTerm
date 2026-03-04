import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Play, Plus, Settings, Trash2, GripVertical } from "lucide-react";
import { useQuickCommandsStore, type QuickCommand } from "@/store/quick-commands";
import { useTabsStore } from "@/store/tabs";
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
import { Checkbox } from "@/components/ui/checkbox";
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
}: {
  cmd: QuickCommand;
  onClick: () => void;
  onContextMenu: () => void;
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
    <div ref={setNodeRef} style={style} className="flex items-center">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs whitespace-nowrap gap-1"
            onClick={onClick}
            title={cmd.autoExecute ? "自动执行" : "仅输入"}
            disabled={isDragging}
          >
            <span
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation();
                listeners.onDragStart?.(e as unknown as React.MouseEvent);
              }}
            >
              <GripVertical className="h-3 w-3 text-muted-foreground" />
            </span>
            {cmd.label}
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onContextMenu}>
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

  // 发送命令到当前激活的终端
  const handleCommandClick = (cmd: QuickCommand) => {
    const activeSession = sessions.find((s) => s.id === activeSessionId);
    if (activeSession?.connector) {
      if (cmd.autoExecute) {
        // 多行命令，每行分开执行
        const lines = cmd.command.split('\n').filter(line => line.trim());
        lines.forEach((line) => {
          // 每行都发送回车执行
          const commandToSend = line.trimEnd() + "\r";
          if (activeSession?.connector) {
            activeSession.connector.write(commandToSend);
          }
        });
      } else {
        // 仅输入，不自动执行
        activeSession.connector.write(cmd.command);
      }
    }
  };

  // 发送命令到所有终端会话
  const sendToAllSessions = (cmd: QuickCommand) => {
    const connectors = getAllConnectors();
    if (connectors.length === 0) return;

    connectors.forEach((connector) => {
      if (cmd.autoExecute) {
        // 多行命令，每行分开执行
        const lines = cmd.command.split('\n').filter(line => line.trim());
        lines.forEach((line) => {
          const commandToSend = line.trimEnd() + "\r";
          connector.write(commandToSend);
        });
      } else {
        // 仅输入，不自动执行
        connector.write(cmd.command);
      }
    });
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

  return (
    <div className="flex items-center gap-2 h-full px-2">
      <Play className="h-4 w-4 text-muted-foreground shrink-0" />
      
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedCommands.map(cmd => cmd.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex gap-1 overflow-x-auto flex-1">
            {sortedCommands.map((cmd) => (
              <SortableQuickCommand
                key={cmd.id}
                cmd={cmd}
                onClick={() => handleCommandClick(cmd)}
                onContextMenu={() => sendToAllSessions(cmd)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* 配置按钮 */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            <Settings className="h-3 w-3" />
          </Button>
        </DialogTrigger>
        
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>快捷命令配置</DialogTitle>
          </DialogHeader>
          
          <QuickCommandForm 
            onAdd={handleAddCommand}
            onRemove={removeCommand}
            onUpdate={updateCommand}
            commands={commands}
            onClose={() => setConfigOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 快捷命令配置表单组件
function QuickCommandForm({
  onAdd,
  onRemove,
  onUpdate,
  commands,
  onClose
}: {
  onAdd: (cmd: Omit<QuickCommand, "id">) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<QuickCommand>) => void;
  commands: QuickCommand[];
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [autoExecute, setAutoExecute] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !command.trim()) return;
    
    if (editingId) {
      onUpdate(editingId, { 
        label: label.trim(), 
        command: command.trim(),
        autoExecute 
      });
      setEditingId(null);
    } else {
      onAdd({ 
        label: label.trim(), 
        command: command.trim(), 
        autoExecute,
        order: commands.length 
      });
    }
    
    setLabel("");
    setCommand("");
    setAutoExecute(false);
  };

  const handleEdit = (cmd: QuickCommand) => {
    setEditingId(cmd.id);
    setLabel(cmd.label);
    setCommand(cmd.command);
    setAutoExecute(cmd.autoExecute);
  };

  const handleCancel = () => {
    setEditingId(null);
    setLabel("");
    setCommand("");
    setAutoExecute(false);
  };

  return (
    <div className="space-y-4">
      {/* 添加/编辑命令表单 */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="label">名称</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="如：清屏"
            />
          </div>
          <div className="space-y-2 flex items-end">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="autoExecute"
                checked={autoExecute}
                onCheckedChange={(checked) => setAutoExecute(checked as boolean)}
              />
              <Label
                htmlFor="autoExecute"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                自动执行
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              选中后每行命令自动发送回车执行
            </p>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="command">命令</Label>
          <Textarea
            id="command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="输入命令，支持多行&#10;如：&#10;cd project&#10;npm install"
            rows={4}
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
              onClick={handleCancel}
            >
              取消
            </Button>
          )}
        </div>
      </form>

      {/* 命令列表 */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        <Label>已有命令（点击删除）</Label>
        {commands.map((cmd) => (
          <div
            key={cmd.id}
            className="flex items-center justify-between p-2 border rounded-md group"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{cmd.label}</div>
              <div className="text-xs text-muted-foreground truncate font-mono whitespace-pre-wrap">
                {cmd.command}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs px-1.5 py-0.5 rounded ${cmd.autoExecute ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                  {cmd.autoExecute ? "自动执行" : "仅输入"}
                </span>
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleEdit(cmd)}
              >
                编辑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                onClick={() => onRemove(cmd.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );
}