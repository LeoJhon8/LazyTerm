import React, { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "@/store/settings";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  side: "left" | "right";
}

export function ResizeHandle({ side }: ResizeHandleProps) {
  const { setSettings } = useSettingsStore();
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
    },
    []
  );

  useEffect(() => {
    if (!isDragging) return;

    const MIN_WIDTH = 220;
    const MAX_WIDTH = 400;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (side === "left") {
        const raw = e.clientX;
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw));
        setSettings({ leftPanelWidth: newWidth });
      } else {
        const raw = window.innerWidth - e.clientX;
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw));
        setSettings({ rightPanelWidth: newWidth });
      }
    };

    const onMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isDragging, side, setSettings]);

  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        "group absolute inset-y-0 z-50 w-3 cursor-ew-resize select-none",
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
