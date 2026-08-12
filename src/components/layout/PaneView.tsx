import { useCallback, useEffect, useRef, useState } from "react";
import { X, Maximize2 } from "lucide-react";

import { usePanesStore } from "@/store/panes";
import { useTabsStore } from "@/store/tabs";
import {
  TerminalViewClass,
  RemoteDesktopViewClass,
  VncViewClass,
} from "@/components/terminal";
import { cn } from "@/lib/utils";
import { getDropZone, dropZoneToDirection, type DropZone } from "@/lib/pane-utils";
import { logger } from "@/lib/logger";
import {
  TAB_DRAG_START_EVENT,
  TAB_DRAG_MOVE_EVENT,
  TAB_DRAG_END_EVENT,
} from "@/lib/tab-drag-state";
import { useI18n } from "@/i18n";
import { connectionQualityScheduler } from "@/services/connection/ConnectionQualityScheduler";

interface PaneViewProps {
  paneId: string;
  isVisible: boolean;
}

export function PaneView({ paneId, isVisible }: PaneViewProps) {
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const focusedPaneId = usePanesStore((state) =>
    activeTabId ? state.workspaces[activeTabId]?.focusedPaneId : null
  );
  const { focusPane, removePane, maximizePane, splitPane } = usePanesStore();
  const paneCount = usePanesStore((state) =>
    activeTabId
      ? (state.workspaces[activeTabId]?.rootNode
        ? state.getAllLeaves(activeTabId).length
        : 0)
      : 0
  );
  const sessions = useTabsStore((state) => state.sessions);

  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const [isTabDragging, setIsTabDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const leaf = usePanesStore((state) => state.getLeafById(paneId));
  const isFocused = focusedPaneId === paneId;
  const session = leaf
    ? sessions.find((item) => item.id === leaf.sessionId) ?? null
    : null;
  const isNativeRdpPane = session?.type === "rdp" && session.connector?.protocol === "rdp" && session.connector.backend === "msrdpax";
  const showDockedPaneControls = paneCount > 1 && isNativeRdpPane;

  useEffect(() => {
    const sessionId = session?.id;
    if (!sessionId) {
      return;
    }
    connectionQualityScheduler.setSessionVisible(sessionId, isVisible);
    return () => connectionQualityScheduler.setSessionVisible(sessionId, false);
  }, [isVisible, session?.id]);

  const syncSinglePaneTabTitle = useCallback((tabId: string) => {
    const remainingLeaves = usePanesStore.getState().getAllLeaves(tabId);
    if (remainingLeaves.length !== 1) {
      return;
    }

    const remainingSessionId = remainingLeaves[0]?.sessionId;
    if (!remainingSessionId) {
      return;
    }

    const remainingSession = useTabsStore.getState().sessions.find(
      (item) => item.id === remainingSessionId
    );
    if (!remainingSession) {
      return;
    }

    useTabsStore.getState().updateTab(tabId, { title: remainingSession.title });
  }, []);

  useEffect(() => {
    if (!isVisible) {
      setIsTabDragging(false);
      setDropZone(null);
      return;
    }

    const handleDragStart = () => {
      setIsTabDragging(true);
    };

    const handleDragMove = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || !containerRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const { x, y } = detail;
      const isInside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

      if (!isInside) {
        setDropZone(null);
        return;
      }

      const relativeX = (x - rect.left) / rect.width;
      const relativeY = (y - rect.top) / rect.height;
      setDropZone(getDropZone(relativeX, relativeY));
    };

    const handleDragEnd = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setIsTabDragging(false);

      if (!detail || !containerRef.current) {
        setDropZone(null);
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const { x, y, sessionId: draggedTabId } = detail;
      const isInside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

      if (draggedTabId && isInside) {
        const relativeX = (x - rect.left) / rect.width;
        const relativeY = (y - rect.top) / rect.height;
        const zone = getDropZone(relativeX, relativeY);
        const direction = dropZoneToDirection(zone);

        logger.info("FE/PaneView", "Tab dropped on pane", { paneId, draggedTabId, zone, direction });

        const currentActiveTabId = useTabsStore.getState().activeTabId;
        if (draggedTabId === currentActiveTabId) {
          setDropZone(null);
          return;
        }

        const workspace = usePanesStore.getState().getWorkspace(draggedTabId);
        const droppingLeaf = workspace.focusedPaneId
          ? usePanesStore.getState().getLeafById(workspace.focusedPaneId)
          : usePanesStore.getState().getAllLeaves(draggedTabId)[0];
        const sessionToMove = droppingLeaf?.sessionId;

        if (sessionToMove) {
          splitPane(paneId, direction, sessionToMove, zone);
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
  }, [isVisible, paneId, splitPane]);

  const handlePaneClick = useCallback(() => {
    focusPane(paneId);
  }, [focusPane, paneId]);

  const handleClose = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();

    const currentTabId = useTabsStore.getState().activeTabId;
    const sessionId = leaf?.sessionId;

    if (sessionId) {
      useTabsStore.getState().removeSession(sessionId);
    }

    removePane(paneId);

    if (currentTabId) {
      syncSinglePaneTabTitle(currentTabId);
    }
  }, [leaf?.sessionId, paneId, removePane, syncSinglePaneTabTitle]);

  const handleMaximize = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();

    const currentTabId = useTabsStore.getState().activeTabId;
    const result = maximizePane(paneId);
    if (!currentTabId || !result) {
      return;
    }

    const tabsStore = useTabsStore.getState();
    const keptSession = result.keptSessionId
      ? tabsStore.sessions.find((item) => item.id === result.keptSessionId) ?? null
      : null;

    if (keptSession) {
      tabsStore.updateTab(currentTabId, { title: keptSession.title });
    }

    result.detachedSessionIds.forEach((sessionId) => {
      const detachedSession = useTabsStore.getState().sessions.find((item) => item.id === sessionId);
      useTabsStore.getState().addTab({
        title: detachedSession?.title ?? "Terminal",
      });
      usePanesStore.getState().addPane(sessionId);
    });

    useTabsStore.getState().setActiveTabId(currentTabId);
    focusPane(paneId);
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("lazy-term-focus"));
    });
  }, [focusPane, maximizePane, paneId]);

  if (!leaf || !session) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "group relative flex h-full w-full min-h-0 flex-col overflow-hidden transition-colors",
        paneCount > 1 && "border border-border/40",
        paneCount > 1 && isFocused && "border-primary/50 ring-1 ring-inset ring-primary/40",
      )}
      onClick={handlePaneClick}
    >
      {showDockedPaneControls && (
        <div className="relative z-20 flex h-8 shrink-0 items-center justify-end border-b border-border/50 bg-background/95 pl-2 backdrop-blur-sm">
          <div className="mr-auto truncate text-[11px] text-muted-foreground/70">
            {session.title}
          </div>
          <PaneControlButtons
            onClose={handleClose}
            onMaximize={handleMaximize}
            showMaximize
            compact
          />
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {session.type === "rdp" ? (
          <RemoteDesktopViewClass
            key={session.id}
            paneId={paneId}
            sessionId={session.id}
            isVisible={isVisible}
          />
        ) : session.type === "vnc" ? (
          <VncViewClass
            key={session.id}
            paneId={paneId}
            sessionId={session.id}
            isVisible={isVisible}
          />
        ) : (
          <TerminalViewClass
            key={session.id}
            paneId={paneId}
            sessionId={session.id}
            isVisible={isVisible}
          />
        )}
      </div>

      {isTabDragging && dropZone && <DropZoneOverlay zone={dropZone} />}

      {!showDockedPaneControls && paneCount > 1 && (
        <PaneControls
          onClose={handleClose}
          onMaximize={handleMaximize}
          showMaximize
        />
      )}
    </div>
  );
}

function DropZoneOverlay({ zone }: { zone: DropZone }) {
  const { t } = useI18n();
  const overlayStyle: Record<DropZone, string> = {
    left: "left-0 top-0 h-full w-1/2",
    right: "right-0 top-0 h-full w-1/2",
    top: "left-0 top-0 h-1/2 w-full",
    bottom: "left-0 bottom-0 h-1/2 w-full",
  };
  const overlayLabel: Record<DropZone, string> = {
    left: t("← 左侧分屏"),
    right: t("右侧分屏 →"),
    top: t("↑ 上方分屏"),
    bottom: t("下方分屏 ↓"),
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-50">
      <div
        className={cn(
          "absolute rounded-sm border-2 border-sky-400/50 bg-sky-500/20 transition-all duration-150",
          overlayStyle[zone],
        )}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-md bg-sky-500/80 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
            {overlayLabel[zone]}
          </div>
        </div>
      </div>
    </div>
  );
}

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
        "absolute left-0 right-0 top-0 z-20",
        "flex h-8 items-center justify-end",
        "bg-gradient-to-b from-background/90 to-transparent",
        "opacity-0 -translate-y-full transition-all duration-200",
        "group-hover:translate-y-0 group-hover:opacity-100",
      )}
    >
      <PaneControlButtons
        onClose={onClose}
        onMaximize={onMaximize}
        showMaximize={showMaximize}
      />
    </div>
  );
}

function PaneControlButtons({
  onClose,
  onMaximize,
  showMaximize,
  compact = false,
}: {
  onClose: (e: React.MouseEvent) => void;
  onMaximize: (e: React.MouseEvent) => void;
  showMaximize: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className={cn("flex items-center gap-1 pr-2", compact ? "" : "pt-1")}>
      {showMaximize && (
        <button
          className="rounded-sm p-0.5 text-muted-foreground/70 transition-colors hover:bg-accent/80 hover:text-foreground"
          onClick={onMaximize}
          title={t("最大化面板")}
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      )}
      <button
        className="rounded-sm p-0.5 text-muted-foreground/70 transition-colors hover:bg-destructive/20 hover:text-destructive"
        onClick={onClose}
        title={t("关闭面板")}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
