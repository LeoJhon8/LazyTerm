import type { ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useConnectionTypeOrderStore, type ConnectionTypeId } from "@/store/connection-type-order";

export interface ConnectionTypeOption<T extends ConnectionTypeId> {
  type: T;
  icon: ReactNode;
  labelKey: string;
}

function SortableConnectionTypeButton<T extends ConnectionTypeId>({
  option,
  selected,
  onSelect,
}: {
  option: ConnectionTypeOption<T>;
  selected: boolean;
  onSelect: (type: T) => void;
}) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: option.type });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onSelect(option.type)}
      className={cn(
        "flex items-center gap-2.5 w-full rounded-xl px-2 py-2 text-[13px] font-medium transition-colors",
        selected
          ? "bg-accent/80 text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
        isDragging && "opacity-70 shadow-sm",
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <span
        className="flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground/60 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      {option.icon}
      <span className="truncate">{t(option.labelKey as any)}</span>
    </button>
  );
}

export function ConnectionTypeList<T extends ConnectionTypeId>({
  options,
  selectedType,
  onSelect,
}: {
  options: Array<ConnectionTypeOption<T>>;
  selectedType: T;
  onSelect: (type: T) => void;
}) {
  const { t } = useI18n();
  const connectionTypeOrder = useConnectionTypeOrderStore((state) => state.connectionTypeOrder);
  const reorderConnectionTypes = useConnectionTypeOrderStore((state) => state.reorderConnectionTypes);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const optionMap = new Map(options.map((option) => [option.type, option]));
  const orderedOptions = connectionTypeOrder
    .filter((type): type is T => optionMap.has(type as T))
    .map((type) => optionMap.get(type as T)!);
  const orderedIds = orderedOptions.map((option) => option.type);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = orderedIds.indexOf(active.id as T);
    const newIndex = orderedIds.indexOf(over.id as T);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    reorderConnectionTypes(arrayMove(orderedIds, oldIndex, newIndex));
  };

  return (
    <div className="w-44 shrink-0 border-r border-border/50 bg-muted/20 px-2 py-2">
      <div className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider px-2 py-1.5">
        {t("连接类型")}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-1">
            {orderedOptions.map((option) => (
              <SortableConnectionTypeButton
                key={option.type}
                option={option}
                selected={selectedType === option.type}
                onSelect={onSelect}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
