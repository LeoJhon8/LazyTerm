import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Clock3,
  GripVertical,
  ListChecks,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  useQuickCommandsStore,
  type QuickCommand,
} from "@/store/quick-commands";

type EditorState =
  | { mode: "new"; revision: number }
  | { mode: "edit"; commandId: string };

type SortKey = "name" | "createdAt";
type SortDirection = "asc" | "desc";

function SortableManagerRow({
  command,
  selected,
  createdAtLabel,
  onSelect,
  onEdit,
  onDelete,
}: {
  command: QuickCommand;
  selected: boolean;
  createdAtLabel: string;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: command.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-selected={selected}
      className="group flex min-h-15 items-center gap-2 border-b border-border/55 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-accent/45 data-[selected=true]:bg-primary/8"
    >
      <Checkbox
        checked={selected}
        onCheckedChange={onSelect}
        aria-label={t("选择 {name}", { name: command.label })}
      />
      <button
        type="button"
        className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground/60 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        title={t("拖动排序")}
        aria-label={t("拖动排序")}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="min-w-0 flex-1 rounded-lg px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onEdit}
      >
        <span className="block truncate text-sm font-medium text-foreground">
          {command.label}
        </span>
        <code className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
          {command.command.replace(/\r?\n/g, " · ")}
        </code>
      </button>
      <time
        dateTime={new Date(command.createdAt).toISOString()}
        className="hidden w-24 shrink-0 items-center gap-1 text-[10px] text-muted-foreground/75 min-[820px]:flex"
        title={`${t("创建时间")}：${createdAtLabel}`}
      >
        <Clock3 className="h-3 w-3" />
        <span className="truncate">{createdAtLabel}</span>
      </time>
      <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg"
          onClick={onEdit}
          title={t("编辑")}
          aria-label={t("编辑")}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg hover:bg-destructive/12 hover:text-destructive"
          onClick={onDelete}
          title={t("删除")}
          aria-label={t("删除")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function CommandEditor({
  command,
  mode,
  onSave,
  onCancel,
}: {
  command?: QuickCommand;
  mode: "new" | "edit";
  onSave: (values: { label: string; command: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(command?.label ?? "");
  const [commandText, setCommandText] = useState(command?.command ?? "");
  const canSave = label.trim().length > 0 && commandText.trim().length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;
    onSave({ label: label.trim(), command: commandText });
  };

  return (
    <form className="flex min-h-full flex-col p-5" onSubmit={handleSubmit}>
      <div>
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          {mode === "new" ? (
            <Plus className="h-4 w-4 text-primary" />
          ) : (
            <Pencil className="h-4 w-4 text-primary" />
          )}
          {mode === "new" ? t("新建命令") : t("编辑快捷命令")}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {mode === "new"
            ? t("填写名称和命令内容，保存后会显示在快捷命令栏末尾。")
            : t("修改会立即同步到快捷命令栏。")}
        </p>
      </div>

      <div className="mt-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="quick-command-manager-label">{t("命令名称")}</Label>
          <Input
            id="quick-command-manager-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t("输入便于识别的名称")}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="quick-command-manager-command">{t("命令")}</Label>
          <Textarea
            id="quick-command-manager-command"
            value={commandText}
            onChange={(event) => setCommandText(event.target.value)}
            placeholder={t("输入命令，支持换行")}
            rows={9}
            className="resize-none font-mono text-xs leading-5"
          />
        </div>
      </div>

      <div className="mt-auto flex justify-end gap-2 pt-6">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("取消")}
        </Button>
        <Button type="submit" size="sm" disabled={!canSave}>
          {t("保存")}
        </Button>
      </div>
    </form>
  );
}

export function QuickCommandManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const commands = useQuickCommandsStore((state) => state.commands);
  const addCommand = useQuickCommandsStore((state) => state.addCommand);
  const updateCommand = useQuickCommandsStore((state) => state.updateCommand);
  const removeCommands = useQuickCommandsStore((state) => state.removeCommands);
  const reorderCommands = useQuickCommandsStore((state) => state.reorderCommands);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [editorState, setEditorState] = useState<EditorState>({ mode: "new", revision: 0 });
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [sortState, setSortState] = useState<{
    key: SortKey;
    direction: SortDirection;
  } | null>(null);

  const sortedCommands = useMemo(
    () => [...commands].sort((a, b) => a.order - b.order),
    [commands],
  );
  const filteredCommands = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return sortedCommands;

    return sortedCommands.filter((item) =>
      `${item.label}\n${item.command}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [searchQuery, sortedCommands]);
  const editingCommand = editorState.mode === "edit"
    ? commands.find((item) => item.id === editorState.commandId)
    : undefined;
  const allFilteredSelected = filteredCommands.length > 0
    && filteredCommands.every((item) => selectedIds.has(item.id));
  const someFilteredSelected = filteredCommands.some((item) => selectedIds.has(item.id));
  const nameCollator = useMemo(
    () => new Intl.Collator(locale, { numeric: true, sensitivity: "base" }),
    [locale],
  );
  const createdAtFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    [locale],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const availableIds = new Set(commands.map((item) => item.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });

    if (editorState.mode === "edit" && !availableIds.has(editorState.commandId)) {
      setEditorState({ mode: "new", revision: 0 });
    }
  }, [commands, editorState]);

  const showFreshNewEditor = () => {
    setEditorState((current) => ({
      mode: "new",
      revision: current.mode === "new" ? current.revision + 1 : 0,
    }));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setSearchQuery("");
      setSelectedIds(new Set());
      setEditorState({ mode: "new", revision: 0 });
      setPendingDeleteIds([]);
      setSortState(null);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        filteredCommands.forEach((item) => next.delete(item.id));
      } else {
        filteredCommands.forEach((item) => next.add(item.id));
      }
      return next;
    });
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const currentOrder = sortedCommands.map((item) => item.id);
    const oldIndex = currentOrder.indexOf(String(active.id));
    const newIndex = currentOrder.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    reorderCommands(arrayMove(currentOrder, oldIndex, newIndex));
    setSortState(null);
  };

  const handleQuickSort = (key: SortKey) => {
    const direction: SortDirection = sortState?.key === key && sortState.direction === "asc"
      ? "desc"
      : "asc";
    const directionMultiplier = direction === "asc" ? 1 : -1;
    const nextOrder = [...sortedCommands].sort((a, b) => {
      const comparison = key === "name"
        ? nameCollator.compare(a.label, b.label)
        : a.createdAt - b.createdAt;

      return comparison === 0
        ? a.order - b.order
        : comparison * directionMultiplier;
    });

    reorderCommands(nextOrder.map((item) => item.id));
    setSortState({ key, direction });
  };

  const handleConfirmDelete = () => {
    removeCommands(pendingDeleteIds);
    setPendingDeleteIds([]);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="grid h-[min(680px,calc(100vh-32px))] w-[min(940px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border/65 px-6 py-5 pr-14">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <ListChecks className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <DialogTitle>{t("管理快捷命令")}</DialogTitle>
                <DialogDescription className="mt-1.5">
                  {t("在一处搜索、排序和批量整理你的常用命令。")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(280px,36%)]">
            <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
              <div className="flex items-center gap-3 border-b border-border/55 px-4 py-3">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t("搜索名称或命令...")}
                    aria-label={t("搜索名称或命令...")}
                    className="h-9 pl-9 text-xs"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={showFreshNewEditor}
                >
                  <Plus className="h-4 w-4" />
                  {t("新建命令")}
                </Button>
              </div>

              <div className="flex h-10 items-center gap-2 border-b border-border/55 bg-muted/25 px-3 text-[11px] text-muted-foreground">
                <Checkbox
                  checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAllFiltered}
                  disabled={filteredCommands.length === 0}
                  aria-label={t("全选当前列表")}
                />
                <span className="ml-8 flex-1">
                  {t("{count} 条命令", { count: filteredCommands.length })}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant={sortState?.key === "name" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 rounded-lg px-2 text-[11px]"
                    disabled={commands.length < 2}
                    aria-pressed={sortState?.key === "name"}
                    title={t("按名称排序")}
                    onClick={() => handleQuickSort("name")}
                  >
                    {t("名称")}
                    {sortState?.key === "name" ? (
                      sortState.direction === "asc"
                        ? <ArrowUp className="h-3 w-3" />
                        : <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant={sortState?.key === "createdAt" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 rounded-lg px-2 text-[11px]"
                    disabled={commands.length < 2}
                    aria-pressed={sortState?.key === "createdAt"}
                    title={t("按创建时间排序")}
                    onClick={() => handleQuickSort("createdAt")}
                  >
                    {t("创建时间")}
                    {sortState?.key === "createdAt" ? (
                      sortState.direction === "asc"
                        ? <ArrowUp className="h-3 w-3" />
                        : <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>

              <ScrollArea className="min-h-0">
                {filteredCommands.length > 0 ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={filteredCommands.map((item) => item.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div>
                        {filteredCommands.map((command) => (
                          <SortableManagerRow
                            key={command.id}
                            command={command}
                            selected={selectedIds.has(command.id)}
                            createdAtLabel={createdAtFormatter.format(command.createdAt)}
                            onSelect={() => toggleSelected(command.id)}
                            onEdit={() => setEditorState({ mode: "edit", commandId: command.id })}
                            onDelete={() => setPendingDeleteIds([command.id])}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div className="flex h-full min-h-64 flex-col items-center justify-center px-8 text-center">
                    <Search className="mb-3 h-8 w-8 text-muted-foreground/45" />
                    <p className="text-sm font-medium">
                      {commands.length === 0
                        ? t("还没有快捷命令")
                        : t("暂无匹配的快捷命令")}
                    </p>
                    <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
                      {commands.length === 0
                        ? t("新建第一条命令，之后就能从工具栏快速发送。")
                        : t("换个关键词，或者新建一条命令。")}
                    </p>
                  </div>
                )}
              </ScrollArea>
            </section>

            <aside className="min-h-0 border-l border-border/65 bg-muted/18">
              <ScrollArea className="h-full">
                <CommandEditor
                  key={editorState.mode === "new" ? `new-${editorState.revision}` : editorState.commandId}
                  mode={editorState.mode}
                  command={editingCommand}
                  onCancel={showFreshNewEditor}
                  onSave={(values) => {
                    if (editorState.mode === "new") {
                      addCommand(values);
                    } else {
                      updateCommand(editorState.commandId, values);
                    }
                    setSortState(null);
                    showFreshNewEditor();
                  }}
                />
              </ScrollArea>
            </aside>
          </div>

          <DialogFooter className="flex-row items-center justify-between border-t border-border/65 bg-background/55 px-5 py-3 sm:justify-between sm:space-x-0">
            <div className="flex items-center gap-3">
              <span className={cn(
                "text-xs text-muted-foreground",
                selectedIds.size > 0 && "font-medium text-foreground",
              )}>
                {t("已选择 {count} 项", { count: selectedIds.size })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={selectedIds.size === 0}
                onClick={() => setPendingDeleteIds([...selectedIds])}
              >
                <Trash2 className="h-4 w-4" />
                {t("删除所选")}
              </Button>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
              {t("关闭")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDeleteIds.length > 0}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingDeleteIds([]);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("确认删除 {count} 条快捷命令？", { count: pendingDeleteIds.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("删除后无法恢复，请确认是否继续。")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/92"
              onClick={handleConfirmDelete}
            >
              {t("确认删除")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
