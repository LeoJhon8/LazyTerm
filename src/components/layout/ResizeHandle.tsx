import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useSettingsStore } from "@/store/settings";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  side: "left" | "right";
}

const MIN_WIDTH = 220;
const MAX_WIDTH = 400;

export function ResizeHandle({ side }: ResizeHandleProps) {
  const setSettings = useSettingsStore((state) => state.setSettings);
  const [isDragging, setIsDragging] = useState(false);
  const activePointerId = useRef<number | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || activePointerId.current !== null) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerId.current = event.pointerId;
    setIsDragging(true);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return;

    activePointerId.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
      endDrag(event);
      return;
    }

    const rawWidth = side === "left" ? event.clientX : window.innerWidth - event.clientX;
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rawWidth));
    setSettings(side === "left" ? { leftPanelWidth: width } : { rightPanelWidth: width });
  };

  useEffect(() => {
    if (!isDragging) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isDragging]);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      className={cn(
        "group absolute inset-y-0 z-50 w-3 touch-none cursor-ew-resize select-none",
        side === "left" ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-200",
          isDragging
            ? "h-20 w-0.5 bg-primary/80 opacity-100 shadow-[0_0_10px_color-mix(in_srgb,var(--primary)_45%,transparent)]"
            : "h-10 w-px bg-border/80 opacity-55 group-hover:h-16 group-hover:w-0.5 group-hover:bg-primary/60 group-hover:opacity-100",
        )}
      />
    </div>
  );
}
