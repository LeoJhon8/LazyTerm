import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import {
  DEFAULT_MOBILE_TERMINAL_KEYS,
  createCustomMobileTerminalKey,
  getMobileTerminalKeyItemId,
  parseMobileTerminalKeyCombination,
  resolveMobileTerminalKeyDefinition,
  type MobileTerminalKeyItem,
  type MobileTerminalKeyParseError,
} from "@/lib/mobile-terminal-keys";
import { useSettingsStore } from "@/store/settings";

function SortableKeyChip({
  item,
  onRemove,
}: {
  item: MobileTerminalKeyItem;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const definition = resolveMobileTerminalKeyDefinition(item);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: definition.id });
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
      className="flex h-10 items-center overflow-hidden rounded-xl border border-border/75 bg-background/70 shadow-sm"
    >
      <button
        type="button"
        className="flex h-full w-8 touch-none items-center justify-center text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        title={t("拖动排序")}
        aria-label={t("拖动 {key} 调整顺序", { key: definition.label })}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-11 px-1.5 text-center font-mono text-xs font-medium">
        {definition.label}
      </span>
      <button
        type="button"
        className="flex h-full w-8 items-center justify-center text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onRemove}
        title={t("移除 {key}", { key: definition.label })}
        aria-label={t("移除 {key}", { key: definition.label })}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function getParseErrorMessage(
  t: ReturnType<typeof useI18n>["t"],
  error: MobileTerminalKeyParseError,
  token?: string,
) {
  switch (error) {
    case "empty":
      return t("请输入组合键");
    case "too-many":
      return t("每个组合键最多包含三个按键");
    case "unsupported-key":
      return t("不支持按键 {key}", { key: token ?? "" });
    case "duplicate-key":
      return t("不能重复使用同一个按键");
    case "missing-primary":
      return t("组合键需要包含一个普通按键");
    case "multiple-primary":
      return t("一个组合键只能包含一个普通按键");
  }
}

export function MobileTerminalKeyBarEditorDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const terminalKeys = useSettingsStore((state) => state.mobileTerminalKeys);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const [combinationInput, setCombinationInput] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!open) setCombinationInput("");
  }, [open]);

  const parseResult = useMemo(
    () => parseMobileTerminalKeyCombination(combinationInput),
    [combinationInput],
  );
  const isDuplicate = parseResult.ok && terminalKeys.some(
    (item) => resolveMobileTerminalKeyDefinition(item).label === parseResult.definition.label,
  );
  const validationMessage = combinationInput.trim().length === 0
    ? null
    : parseResult.ok
      ? isDuplicate ? t("该组合键已在快捷栏中") : null
      : getParseErrorMessage(t, parseResult.error, parseResult.token);

  const itemIds = terminalKeys.map(getMobileTerminalKeyItemId);
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = itemIds.indexOf(String(active.id));
    const newIndex = itemIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setSettings({ mobileTerminalKeys: arrayMove(terminalKeys, oldIndex, newIndex) });
  };

  const removeKey = (id: string) => {
    setSettings({
      mobileTerminalKeys: terminalKeys.filter((item) => getMobileTerminalKeyItemId(item) !== id),
    });
  };

  const handleAddCombination = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!parseResult.ok || isDuplicate) return;
    setSettings({
      mobileTerminalKeys: [
        ...terminalKeys,
        createCustomMobileTerminalKey(parseResult.keys),
      ],
    });
    setCombinationInput("");
  };

  const defaultIds = DEFAULT_MOBILE_TERMINAL_KEYS.map(getMobileTerminalKeyItemId);
  const isDefaultLayout = itemIds.length === defaultIds.length
    && itemIds.every((id, index) => id === defaultIds[index]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-16px)] w-[min(520px,calc(100vw-16px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:rounded-3xl">
        <DialogHeader className="border-b border-border/65 px-5 py-4 pr-12 text-left">
          <DialogTitle>{t("编辑终端快捷栏")}</DialogTitle>
          <DialogDescription>
            {t("只保留你在手机终端中真正需要的按键。")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-4 py-4">
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{t("当前快捷栏")}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("拖动调整顺序，修改会立即生效。")}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("{count} 个按键", { count: terminalKeys.length })}
              </span>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={itemIds} strategy={rectSortingStrategy}>
                <div className="flex min-h-14 flex-wrap content-start gap-2 rounded-2xl border border-border/60 bg-muted/18 p-2">
                  {terminalKeys.map((item) => {
                    const id = getMobileTerminalKeyItemId(item);
                    return <SortableKeyChip key={id} item={item} onRemove={() => removeKey(id)} />;
                  })}
                  {terminalKeys.length === 0 && (
                    <div className="flex min-h-10 w-full items-center justify-center text-xs text-muted-foreground">
                      {t("快捷栏为空，可从下方添加按键。")}
                    </div>
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </section>

          <section className="mt-5">
            <h3 className="text-sm font-semibold">{t("自定义组合键")}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("输入一至三个按键并用加号连接，例如 Ctrl+W 或 Ctrl+Alt+K。")}
            </p>
            <form className="mt-3" onSubmit={handleAddCombination}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    value={combinationInput}
                    onChange={(event) => setCombinationInput(event.target.value)}
                    placeholder={t("输入组合键，例如 Ctrl+W")}
                    aria-label={t("自定义组合键")}
                    className="h-10 font-mono"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <p className="mt-1.5 min-h-4 text-[11px] leading-4 text-muted-foreground">
                    {validationMessage
                      ? <span className="text-destructive">{validationMessage}</span>
                      : t("支持 Ctrl、Alt、Shift、A-Z、Esc、Tab、方向键、Home、End 和 Del。")}
                  </p>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  className="h-10 shrink-0"
                  disabled={!parseResult.ok || isDuplicate}
                >
                  <Plus className="h-4 w-4" />
                  {t("添加")}
                </Button>
              </div>
            </form>
          </section>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-border/65 px-4 py-3 sm:justify-between sm:space-x-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isDefaultLayout}
            onClick={() => setSettings({
              mobileTerminalKeys: DEFAULT_MOBILE_TERMINAL_KEYS.map((item) => ({ ...item })),
            })}
          >
            <RotateCcw className="h-4 w-4" />
            {t("恢复默认")}
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {t("完成")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
