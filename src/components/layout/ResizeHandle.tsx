import React, { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "@/store/settings";

interface ResizeHandleProps {
  side: "left" | "right";
}

export function ResizeHandle({ side }: ResizeHandleProps) {
  const { setSettings } = useSettingsStore();
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      if (side === "left") {
        // 对于左侧，鼠标 X 坐标即为宽度
        const newWidth = Math.min(300, Math.max(150, e.clientX));
        setSettings({ leftPanelWidth: newWidth });
      } else {
        // 对于右侧，宽度为 窗口宽度 - 鼠标 X 坐标
        const newWidth = Math.min(300, Math.max(150, window.innerWidth - e.clientX));
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
