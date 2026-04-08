import { useCallback, useRef, useState } from "react";
import { usePanesStore, type PaneNode, type PaneSplit } from "@/store/panes";
import { PaneView } from "./PaneView";
import { cn } from "@/lib/utils";
import { isLeaf } from "@/lib/pane-utils";

import { useTabsStore } from "@/store/tabs";

/**
 * 面板容器组件
 * 递归渲染面板树
 */
export function PaneContainer() {
  const activeTabId = useTabsStore(state => state.activeTabId);
  const rootNode = usePanesStore(state => activeTabId ? state.workspaces[activeTabId]?.rootNode : null);

  // 没有面板：显示欢迎页
  if (!rootNode) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-semibold text-muted-foreground mb-2">
            欢迎使用 Lazy Term
          </div>
          <div className="text-sm text-muted-foreground">
            点击左侧会话列表开始连接
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <PaneNodeRenderer node={rootNode} />
    </div>
  );
}

/**
 * 递归渲染器 — 根据节点类型分发
 */
function PaneNodeRenderer({ node }: { node: PaneNode }) {
  if (isLeaf(node)) {
    return <PaneView paneId={node.id} />;
  }
  return <PaneSplitView split={node} />;
}

/**
 * 分裂节点视图 — 两个子节点 + 调整手柄
 */
function PaneSplitView({ split }: { split: PaneSplit }) {
  const isHorizontal = split.direction === "horizontal";

  return (
    <div
      className={cn(
        "relative h-full w-full flex",
        isHorizontal ? "flex-row" : "flex-col"
      )}
    >
      {/* 第一个子节点 */}
      <div
        className="relative overflow-hidden"
        style={{
          flex: `0 0 ${split.ratio * 100}%`,
          minWidth: isHorizontal ? "80px" : undefined,
          minHeight: !isHorizontal ? "60px" : undefined,
        }}
      >
        <PaneNodeRenderer node={split.children[0]} />
      </div>

      {/* 调整手柄 */}
      <SplitResizeHandle splitId={split.id} direction={split.direction} />

      {/* 第二个子节点 */}
      <div
        className="relative overflow-hidden flex-1"
        style={{
          minWidth: isHorizontal ? "80px" : undefined,
          minHeight: !isHorizontal ? "60px" : undefined,
        }}
      >
        <PaneNodeRenderer node={split.children[1]} />
      </div>
    </div>
  );
}

/**
 * 分裂调整手柄
 */
interface SplitResizeHandleProps {
  splitId: string;
  direction: "horizontal" | "vertical";
}

function SplitResizeHandle({ splitId, direction }: SplitResizeHandleProps) {
  const { setSplitRatio } = usePanesStore();
  const [isDragging, setIsDragging] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);

  const isHorizontal = direction === "horizontal";

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const container = handleRef.current?.parentElement;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const containerSize = isHorizontal
      ? containerRect.width
      : containerRect.height;
    const containerStart = isHorizontal
      ? containerRect.left
      : containerRect.top;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = isHorizontal ? e.clientX : e.clientY;
      const relativePos = currentPos - containerStart;
      const newRatio = relativePos / containerSize;
      setSplitRatio(splitId, newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, [isHorizontal, splitId, setSplitRatio]);

  return (
    <div
      ref={handleRef}
      className={cn(
        "relative z-10 flex items-center justify-center",
        "bg-border/30 hover:bg-primary/40 transition-colors",
        isDragging && "bg-primary/50",
        isHorizontal
          ? "w-1 cursor-col-resize"
          : "h-1 cursor-row-resize"
      )}
      onMouseDown={handleMouseDown}
    >
      <div
        className={cn(
          "rounded-full bg-muted-foreground/40",
          isHorizontal ? "h-8 w-0.5" : "w-8 h-0.5"
        )}
      />
    </div>
  );
}
