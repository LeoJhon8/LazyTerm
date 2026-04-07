import { useCallback, useEffect, useRef, useState } from "react";
import { usePanesStore } from "@/store/panes";
import { useTabsStore } from "@/store/tabs";
import {
  TerminalViewClass,
  RemoteDesktopViewClass,
  VncViewClass,
} from "@/components/terminal";
import { cn } from "@/lib/utils";
import { getDropZone, dropZoneToDirection, type DropZone } from "@/lib/pane-utils";
import { X, Maximize2 } from "lucide-react";
import { logger } from "@/lib/logger";
import {
  TAB_DRAG_START_EVENT,
  TAB_DRAG_MOVE_EVENT,
  TAB_DRAG_END_EVENT,
} from "@/lib/tab-drag-state";

interface PaneViewProps {
  paneId: string;
}

/**
 * 单个面板视图组件
 * 支持从标签栏拖拽分屏 + 关闭/最大化按钮
 */
export function PaneView({ paneId }: PaneViewProps) {
  const activeTabId = useTabsStore(state => state.activeTabId);
  const focusedPaneId = usePanesStore(state => activeTabId ? state.workspaces[activeTabId]?.focusedPaneId : null);
  const { focusPane, removePane, maximizePane, splitPane } = usePanesStore();
  const paneCount = usePanesStore(state => activeTabId ? (state.workspaces[activeTabId]?.rootNode ? state.getAllLeaves(activeTabId).length : 0) : 0);
  const { sessions } = useTabsStore();

  // 拖拽状态
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const [isTabDragging, setIsTabDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 获取当前面板叶子
  const leaf = usePanesStore(state => state.getLeafById(paneId));
  const isFocused = focusedPaneId === paneId;

  // 获取面板关联的会话
  const session = leaf?.sessionId
    ? sessions.find(s => s.id === leaf.sessionId)
    : null;

  // ========== 监听跨组件拖拽事件 ==========

  useEffect(() => {
    const handleDragStart = () => {
      setIsTabDragging(true);
    };

    const handleDragMove = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || !containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      const { x, y } = detail;
      
      // 检查指针是否在当前面板范围内
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const relativeX = (x - rect.left) / rect.width;
        const relativeY = (y - rect.top) / rect.height;
        const zone = getDropZone(relativeX, relativeY);
        setDropZone(zone);
      } else {
        setDropZone(null);
      }
    };

    const handleDragEnd = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setIsTabDragging(false);
      
      if (!detail || !containerRef.current) {
        setDropZone(null);
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      // 在 TabBar 拖拽中，detail.sessionId 实际上是 tabId
      const { x, y, sessionId: draggedTabId } = detail;

      // 检查指针是否在当前面板范围内
      if (
        draggedTabId &&
        x >= rect.left && x <= rect.right &&
        y >= rect.top && y <= rect.bottom
      ) {
        const relativeX = (x - rect.left) / rect.width;
        const relativeY = (y - rect.top) / rect.height;
        const zone = getDropZone(relativeX, relativeY);
        const direction = dropZoneToDirection(zone);

        logger.info("FE/PaneView", "Tab dropped on pane", { paneId, draggedTabId, zone, direction });

        // 获取当前激活的 Tab
        const activeTabId = useTabsStore.getState().activeTabId;

        // 如果拖拽的是当前显示的 Tab，忽略
        if (draggedTabId === activeTabId) {
            setDropZone(null);
            return;
        }

        // 找到拖拽来源 Tab 的主 session
        const ws = usePanesStore.getState().getWorkspace(draggedTabId);
        const droppingLeaf = ws.focusedPaneId 
             ? usePanesStore.getState().getLeafById(ws.focusedPaneId) 
             : usePanesStore.getState().getAllLeaves(draggedTabId)[0];
        
        const sessionToMove = droppingLeaf?.sessionId;

        if (sessionToMove) {
          // 在当前面板分屏显示拖拽过来的 session
          splitPane(paneId, direction, sessionToMove, zone);

          // 关闭原先的 Tab（清理其工作区及它带有的全部内容，除了我们刚移入主工作区的会话）
          // 但是要小心，会话的所有权移交了，所以不要关闭这个 session 的连接！
          // TODO: 对于未迁移的额外 session 理论上需要关闭，目前只简单清理掉工作区和 Tab 实体
          usePanesStore.getState().cleanupWorkspace(draggedTabId);
          useTabsStore.getState().removeTab(draggedTabId);
        }
      }

      setDropZone(null);
    };

    window.addEventListener(TAB_DRAG_START_EVENT, handleDragStart);
    window.addEventListener(TAB_DRAG_MOVE_EVENT, handleDragMove);
    window.addEventListener(TAB_DRAG_END_EVENT, handleDragEnd);

    return () => {
      window.removeEventListener(TAB_DRAG_START_EVENT, handleDragStart);
      window.removeEventListener(TAB_DRAG_MOVE_EVENT, handleDragMove);
      window.removeEventListener(TAB_DRAG_END_EVENT, handleDragEnd);
    };
  }, [paneId, leaf, splitPane]);

  // 点击面板时设置焦点
  const handlePaneClick = useCallback(() => {
    if (!isFocused) {
      focusPane(paneId);
    }
  }, [isFocused, paneId, focusPane]);

  // 关闭面板
  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    removePane(paneId);
  }, [paneId, removePane]);

  // 最大化面板
  const handleMaximize = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    maximizePane(paneId);
  }, [paneId, maximizePane]);

  // ========== 渲染 ==========

  if (!leaf) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background/50">
        <div className="text-sm text-muted-foreground">面板不存在</div>
      </div>
    );
  }

  // 没有关联会话
  if (!session) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "group relative flex h-full w-full items-center justify-center cursor-pointer transition-all",
          "bg-background/50",
          paneCount > 1 && "border border-border/40",
          paneCount > 1 && isFocused && "border-2 border-primary/50",
        )}
        onClick={handlePaneClick}
      >
        <div className="text-center">
          <div className="text-sm text-muted-foreground mb-2">此面板未关联会话</div>
          <div className="text-xs text-muted-foreground/60">
            从标签栏拖拽标签页到此处
          </div>
        </div>

        {/* 拖拽指示器 */}
        {isTabDragging && dropZone && <DropZoneOverlay zone={dropZone} />}

        {/* 面板控制按钮 */}
        {paneCount > 1 && (
          <PaneControls
            onClose={handleClose}
            onMaximize={handleMaximize}
            showMaximize={paneCount > 1}
          />
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "group relative h-full w-full overflow-hidden transition-all",
        paneCount > 1 && "border border-border/40",
        paneCount > 1 && isFocused && "border-2 border-primary/50",
      )}
      onClick={handlePaneClick}
    >
      {/* 面板内容 */}
      {session.type === "rdp" ? (
        <RemoteDesktopViewClass
          key={session.id}
          paneId={paneId}
          sessionId={session.id}
        />
      ) : session.type === "vnc" ? (
        <VncViewClass
          key={session.id}
          paneId={paneId}
          sessionId={session.id}
        />
      ) : (
        <TerminalViewClass
          key={session.id}
          paneId={paneId}
          sessionId={session.id}
        />
      )}

      {/* 拖拽指示器 */}
      {isTabDragging && dropZone && <DropZoneOverlay zone={dropZone} />}

      {/* 面板控制按钮（hover 时显示） */}
      {paneCount > 1 && (
        <PaneControls
          onClose={handleClose}
          onMaximize={handleMaximize}
          showMaximize={paneCount > 1}
        />
      )}
    </div>
  );
}

/**
 * 拖拽放置区域指示器
 */
function DropZoneOverlay({ zone }: { zone: DropZone }) {
  const overlayStyle: Record<DropZone, string> = {
    left: "left-0 top-0 w-1/2 h-full",
    right: "right-0 top-0 w-1/2 h-full",
    top: "left-0 top-0 w-full h-1/2",
    bottom: "left-0 bottom-0 w-full h-1/2",
  };

  return (
    <div className="absolute inset-0 z-50 pointer-events-none">
      <div
        className={cn(
          "absolute transition-all duration-150",
          "bg-sky-500/20 border-2 border-sky-400/50 rounded-sm",
          overlayStyle[zone]
        )}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="px-3 py-1.5 rounded-md bg-sky-500/80 text-white text-xs font-medium shadow-lg">
            {zone === "left" && "← 左侧分屏"}
            {zone === "right" && "右侧分屏 →"}
            {zone === "top" && "↑ 上方分屏"}
            {zone === "bottom" && "下方分屏 ↓"}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 面板控制按钮（关闭 + 最大化）
 */
function PaneControls({
  onClose,
  onMaximize,
  showMaximize,
}: {
  onClose: (e: React.MouseEvent) => void;
  onMaximize: (e: React.MouseEvent) => void;
  showMaximize: boolean;
}) {
  return (
    <div
      className={cn(
        "absolute top-0 left-0 right-0 z-20",
        "flex items-center justify-end",
        "h-8 transition-all duration-200",
        "bg-gradient-to-b from-background/90 to-transparent",
        "opacity-0 -translate-y-full group-hover:opacity-100 group-hover:translate-y-0"
      )}
    >
      <div className="flex items-center gap-1 pr-2 pt-1">
        {showMaximize && (
          <button
            className="p-0.5 rounded-sm hover:bg-accent/80 text-muted-foreground/70 hover:text-foreground transition-colors"
            onClick={onMaximize}
            title="最大化面板"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        )}
        <button
          className="p-0.5 rounded-sm hover:bg-destructive/20 text-muted-foreground/70 hover:text-destructive transition-colors"
          onClick={onClose}
          title="关闭面板"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
