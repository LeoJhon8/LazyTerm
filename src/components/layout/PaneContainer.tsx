import { useCallback, useRef, useState } from "react";
import { usePanesStore, type PaneNode, type PaneSplit } from "@/store/panes";
import { PaneView } from "./PaneView";
import { WelcomePage } from "./WelcomePage";
import { cn } from "@/lib/utils";
import { isLeaf } from "@/lib/pane-utils";

import { useTabsStore } from "@/store/tabs";

/**
 * 面板容器组件
 * 递归渲染面板树
 */
export function PaneContainer() {
  const activeTabId = useTabsStore(state => state.activeTabId);
  const tabs = useTabsStore(state => state.tabs);
  const workspaces = usePanesStore(state => state.workspaces);
  const activeRootNode = activeTabId ? workspaces[activeTabId]?.rootNode : null;

  return (
    <div className="relative h-full w-full">
      {!activeRootNode && <WelcomePage />}
      {tabs.map((tab) => {
        const rootNode = workspaces[tab.id]?.rootNode;
        if (!rootNode) {
          return null;
        }

        const isVisible = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            aria-hidden={!isVisible}
            data-workspace-id={tab.id}
            data-workspace-visible={isVisible ? "true" : "false"}
            className={cn(
              "absolute inset-0 h-full w-full",
              isVisible
                ? "visible z-10"
                : "invisible z-0 pointer-events-none",
            )}
          >
            <PaneNodeRenderer node={rootNode} isVisible={isVisible} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * 递归渲染器 — 根据节点类型分发
 */
function PaneNodeRenderer({ node, isVisible }: { node: PaneNode; isVisible: boolean }) {
  if (isLeaf(node)) {
    return <PaneView paneId={node.id} isVisible={isVisible} />;
  }
  return <PaneSplitView split={node} isVisible={isVisible} />;
}

/**
 * 分裂节点视图 — 两个子节点 + 调整手柄
 */
function PaneSplitView({ split, isVisible }: { split: PaneSplit; isVisible: boolean }) {
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
        <PaneNodeRenderer node={split.children[0]} isVisible={isVisible} />
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
        <PaneNodeRenderer node={split.children[1]} isVisible={isVisible} />
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
        "group relative z-10 flex items-center justify-center",
        "transition-colors duration-150",
        isHorizontal
          ? "w-[3px] cursor-col-resize hover:w-[4px]"
          : "h-[3px] cursor-row-resize hover:h-[4px]",
        isDragging
          ? "bg-primary/50"
          : "bg-border/40 hover:bg-primary/30"
      )}
      onMouseDown={handleMouseDown}
    >
      <div
        className={cn(
          "rounded-full transition-all duration-150",
          isHorizontal ? "h-8 w-[1px]" : "w-8 h-[1px]",
          isDragging
            ? "bg-primary/80"
            : "bg-muted-foreground/25 group-hover:bg-primary/50"
        )}
      />
    </div>
  );
}
