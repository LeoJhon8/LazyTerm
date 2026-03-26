import { useCallback, useRef, useState } from "react";
import { usePanesStore } from "@/store/panes";
import { PaneView } from "./PaneView";
import { cn } from "@/lib/utils";
import { PanelLeft, PanelTop, X, ArrowLeftRight, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * 面板容器组件
 * 管理多个 Pane 的布局和分屏控制
 */
export function PaneContainer() {
  const { 
    panes, 
    focusedPaneId, 
    canSplit, 
    splitPane, 
    mergePane, 
    swapPanes,
    focusPane,
  } = usePanesStore();
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // 处理分屏
  const handleSplit = useCallback((direction: "horizontal" | "vertical") => {
    if (!focusedPaneId || !canSplit()) return;
    splitPane(focusedPaneId, direction);
  }, [focusedPaneId, canSplit, splitPane]);

  // 处理合并
  const handleMerge = useCallback(() => {
    if (!focusedPaneId || panes.length <= 1) return;
    mergePane(focusedPaneId);
  }, [focusedPaneId, panes.length, mergePane]);

  // 处理交换
  const handleSwap = useCallback(() => {
    if (panes.length !== 2) return;
    swapPanes(panes[0].id, panes[1].id);
  }, [panes, swapPanes]);

  // 获取布局方向（根据第一个面板的方向决定）
  const layoutDirection = panes[0]?.direction || "horizontal";

  // 没有面板：显示桌面首页
  if (panes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-semibold text-muted-foreground mb-2">
            欢迎使用 Lazy Terminal
          </div>
          <div className="text-sm text-muted-foreground">
            点击左侧会话列表开始连接
          </div>
        </div>
      </div>
    );
  }

  // 只有一个面板
  if (panes.length === 1) {
    return (
      <div className="relative h-full w-full">
        <PaneView paneId={panes[0].id} />
        
        {/* 分屏控制条 */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 opacity-0 hover:opacity-100 transition-opacity">
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-background/90 border border-border/50 shadow-sm">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleSplit("horizontal")}
                    disabled={!canSplit()}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>垂直分屏</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleSplit("vertical")}
                    disabled={!canSplit()}
                  >
                    <PanelTop className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>水平分屏</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    );
  }

  // 两个面板：使用 flex 布局
  if (panes.length === 2) {
    const isHorizontal = layoutDirection === "horizontal";
    
    return (
      <div 
        ref={containerRef}
        className={cn(
          "relative h-full w-full flex",
          isHorizontal ? "flex-row" : "flex-col"
        )}
      >
        {/* 第一个面板 */}
        <div 
          className="relative overflow-hidden"
          style={{ 
            flex: `0 0 ${panes[0].size * 100}%`,
            minWidth: isHorizontal ? "200px" : undefined,
            minHeight: !isHorizontal ? "150px" : undefined,
          }}
        >
          <PaneView paneId={panes[0].id} />
        </div>

        {/* 拖拽调整大小的手柄 */}
        <ResizeHandle 
          direction={layoutDirection}
          pane1Id={panes[0].id}
          pane2Id={panes[1].id}
        />

        {/* 第二个面板 */}
        <div 
          className="relative overflow-hidden flex-1"
          style={{ 
            minWidth: isHorizontal ? "200px" : undefined,
            minHeight: !isHorizontal ? "150px" : undefined,
          }}
        >
          <PaneView paneId={panes[1].id} />
        </div>

        {/* 分屏控制条 */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 opacity-0 hover:opacity-100 transition-opacity">
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-background/90 border border-border/50 shadow-sm">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleSwap}
                  >
                    {isHorizontal ? (
                      <ArrowLeftRight className="h-4 w-4" />
                    ) : (
                      <ArrowUpDown className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>交换面板内容</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <div className="w-px h-4 bg-border/50" />
            
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:text-destructive"
                    onClick={handleMerge}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>合并面板</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    );
  }

  // 不应该到达这里（最大2个面板）
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="text-sm text-muted-foreground">不支持的面板数量: {panes.length}</div>
    </div>
  );
}

/**
 * 调整大小手柄组件
 */
interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
  pane1Id: string;
  pane2Id: string;
}

function ResizeHandle({ direction, pane1Id, pane2Id }: ResizeHandleProps) {
  const { panes, setPaneSize } = usePanesStore();
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isHorizontal = direction === "horizontal";

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const startPos = isHorizontal ? e.clientX : e.clientY;
    const pane1 = panes.find(p => p.id === pane1Id);
    const startSize = pane1?.size || 0.5;
    
    // 获取容器尺寸
    const container = containerRef.current?.parentElement;
    if (!container) return;
    
    const containerSize = isHorizontal 
      ? container.clientWidth 
      : container.clientHeight;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = isHorizontal ? e.clientX : e.clientY;
      const delta = currentPos - startPos;
      const deltaRatio = delta / containerSize;
      
      const newSize = Math.max(0.2, Math.min(0.8, startSize + deltaRatio));
      setPaneSize(pane1Id, newSize);
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
  }, [isHorizontal, pane1Id, panes, setPaneSize]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative z-10 flex items-center justify-center",
        "bg-border/50 hover:bg-primary/50 transition-colors",
        isHorizontal 
          ? "w-1 cursor-col-resize" 
          : "h-1 cursor-row-resize"
      )}
      onMouseDown={handleMouseDown}
    >
      {/* 拖拽指示器 */}
      <div 
        className={cn(
          "rounded-full bg-muted-foreground/50",
          isHorizontal ? "h-8 w-0.5" : "w-8 h-0.5"
        )} 
      />
    </div>
  );
}
