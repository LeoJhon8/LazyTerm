import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/store/settings";
import { useSlotConfigStore } from "@/store/slot-config";

interface ResizeHandleProps {
  side: "left" | "right";
}

export function ResizeHandle({ side }: ResizeHandleProps) {
  const { setSettings, leftPanelWidth, rightPanelWidth } = useSettingsStore();
  const { setSlotCollapsed, currentConfig } = useSlotConfigStore();
  const leftSlotCollapsed = currentConfig.left.collapsed;
  const rightSlotCollapsed = currentConfig.right.collapsed;
  const [isDragging, setIsDragging] = useState(false);
  const prevWidthRef = useRef<number | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      // 记录当前宽度以便收起后恢复
      if (side === "left") prevWidthRef.current = leftPanelWidth;
      else prevWidthRef.current = rightPanelWidth;
    },
    [side, leftPanelWidth, rightPanelWidth]
  );

  useEffect(() => {
    if (!isDragging) return;

    const COLLAPSE_THRESHOLD = 220; // 拖到这个像素范围内视为收起
    const MIN_WIDTH = 220; // 可恢复时的最小宽度
    const MAX_WIDTH = 400;

    const onMouseMove = (e: MouseEvent) => {
      if (side === "left") {
        const raw = e.clientX;
        // 当拖到靠近左侧（小于阈值）时收起（折叠插槽为图标栏），不使用全局隐藏
        if (raw <= COLLAPSE_THRESHOLD) {
          if (!leftSlotCollapsed) {
            prevWidthRef.current = leftPanelWidth;
          }
          setSlotCollapsed("left", true);
        } else {
          const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw));
          setSlotCollapsed("left", false);
          setSettings({ leftPanelWidth: newWidth });
        }
      } else {
        const raw = window.innerWidth - e.clientX;
        if (raw <= COLLAPSE_THRESHOLD) {
          if (!rightSlotCollapsed) {
            prevWidthRef.current = rightPanelWidth;
          }
          setSlotCollapsed("right", true);
        } else {
          const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw));
          setSlotCollapsed("right", false);
          setSettings({ rightPanelWidth: newWidth });
        }
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
    };
  }, [isDragging, side, setSettings]);

  return (
    <div
      onMouseDown={onMouseDown}
      className={`absolute top-0 bottom-0 w-1 cursor-col-resize z-50 hover:bg-primary/30 transition-colors ${
        side === "left" ? "right-0" : "left-0"
      } ${isDragging ? "bg-primary/50" : ""}`}
    />
  );
}
