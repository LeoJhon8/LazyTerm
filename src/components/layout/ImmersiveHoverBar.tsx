import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, Maximize2, Minus, Settings, Square, X } from "lucide-react";
import { useTabsStore } from "@/store/tabs";
import { useSettingsStore } from "@/store/settings";
import { useSettingsDialogStore } from "@/store/settings-dialog";
import { useI18n } from "@/i18n";
import { useViewMode } from "@/hooks/useViewMode";
import { cn } from "@/lib/utils";

const appWindow = getCurrentWindow();

/** 鼠标在屏幕顶部多少像素内触发悬浮栏 */
const TRIGGER_ZONE_PX = 4;
const TITLE_BAR_HEIGHT_PX = 36;
const TAB_STRIP_HEIGHT_PX = 32;

/**
 * 沉浸模式悬浮标题栏 + 标签条
 *
 * 当鼠标移至屏幕最顶部区域时，从顶部滑入半透明的标题栏。
 * 离开标题栏一段时间后自动隐藏。
 */
export function ImmersiveHoverBar() {
  const { t } = useI18n();
  const { immersiveHoverBarDelay, immersiveShowTabStrip } = useSettingsStore();
  const { focusSessionId, sessions, tabs, activeTabId, setActiveTabId } = useTabsStore();
  const openSettings = useSettingsDialogStore((s) => s.openSettings);
  const { setViewMode } = useViewMode();

  const [visible, setVisible] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const isPointerInsideBarRef = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);

  const focusSession = useMemo(
    () => sessions.find((s) => s.id === focusSessionId),
    [focusSessionId, sessions],
  );

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const expandedBarHeight = useMemo(
    () => TITLE_BAR_HEIGHT_PX + (immersiveShowTabStrip && tabs.length > 1 ? TAB_STRIP_HEIGHT_PX : 0),
    [immersiveShowTabStrip, tabs.length],
  );

  const isPointerInsideExpandedBar = useCallback((clientX: number, clientY: number) => {
    const height = barRef.current?.offsetHeight ?? expandedBarHeight;
    return (
      clientX >= 0 &&
      clientX <= window.innerWidth &&
      clientY >= 0 &&
      clientY <= height
    );
  }, [expandedBarHeight]);

  // 鼠标离开悬浮栏后延迟隐藏；如果鼠标仍在悬浮栏内则不隐藏
  const scheduleHide = useCallback(() => {
    if (isDragging || isPointerInsideBarRef.current) return;

    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      const lastPointer = lastPointerRef.current;
      const insideExpandedBar = lastPointer
        ? isPointerInsideExpandedBar(lastPointer.x, lastPointer.y)
        : false;

      isPointerInsideBarRef.current = insideExpandedBar;
      if (isDragging || insideExpandedBar) return;
      setVisible(false);
    }, immersiveHoverBarDelay);
  }, [cancelHide, immersiveHoverBarDelay, isDragging, isPointerInsideExpandedBar]);

  useEffect(() => () => {
    cancelHide();
  }, [cancelHide]);

  // 鼠标顶部区域检测
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) return;

      lastPointerRef.current = { x: e.clientX, y: e.clientY };

      if (e.clientY <= TRIGGER_ZONE_PX) {
        isPointerInsideBarRef.current = true;
        cancelHide();
        setVisible(true);
        return;
      }

      if (!visible) return;

      const insideBar = isPointerInsideExpandedBar(e.clientX, e.clientY);
      if (insideBar) {
        isPointerInsideBarRef.current = true;
        cancelHide();
        return;
      }

      if (isPointerInsideBarRef.current) {
        isPointerInsideBarRef.current = false;
        scheduleHide();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [cancelHide, isDragging, isPointerInsideExpandedBar, scheduleHide, visible]);

  // 窗口控制
  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      try {
        if (!cancelled) setIsMaximized(await appWindow.isMaximized());
      } catch {
        // 忽略窗口状态同步失败
      }
    };

    sync();
    const promise = appWindow.onResized(() => {
      void sync();
    });

    return () => {
      cancelled = true;
      void promise.then((fn) => fn());
    };
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  }, []);

  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a")) return;

    setIsDragging(true);
    void appWindow.startDragging().finally(() => {
      setIsDragging(false);
    });
  }, []);

  const handleDragDoubleClick = useCallback(() => {
    void handleToggleMaximize();
  }, [handleToggleMaximize]);

  // 标签切换
  const handleTabClick = useCallback(
    (id: string) => {
      setActiveTabId(id);
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("lazy-term-focus"));
      });
    },
    [setActiveTabId],
  );

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          ref={barRef}
          className={cn(
            "fixed inset-x-0 top-0 z-[9999]",
            "flex flex-col",
            "pointer-events-auto",
          )}
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onMouseEnter={() => {
            isPointerInsideBarRef.current = true;
            cancelHide();
          }}
          onMouseLeave={() => {
            isPointerInsideBarRef.current = false;
            scheduleHide();
          }}
        >
          {/* 悬浮标签条 */}
          {immersiveShowTabStrip && tabs.length > 1 && (
            <div
              className={cn(
                "flex h-7 items-center gap-0.5 px-2 pt-1",
                "bg-background/75 border-b border-border/30 backdrop-blur-xl",
              )}
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={cn(
                    "max-w-32 truncate rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    tab.id === activeTabId
                      ? "bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                  onClick={() => handleTabClick(tab.id)}
                >
                  {tab.title}
                </button>
              ))}
            </div>
          )}

          {/* 悬浮标题栏 */}
          <div
            className={cn(
              "flex h-9 items-center justify-between px-3",
              "bg-background/80 border-b border-border/20 backdrop-blur-xl",
            )}
            onMouseDown={handleDragMouseDown}
            onDoubleClick={handleDragDoubleClick}
          >
            {/* 左侧：品牌 + 会话信息 */}
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-xs font-semibold text-foreground/80">LazyTerm</span>
              {focusSession && (
                <>
                  <span className="shrink-0 text-muted-foreground/40">·</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {focusSession.title}
                  </span>
                  <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary/80">
                    {focusSession.type === "local"
                      ? t("本地终端")
                      : focusSession.type === "ssh"
                        ? "SSH"
                        : focusSession.type === "rdp"
                          ? "RDP"
                          : focusSession.type === "vnc"
                            ? "VNC"
                            : focusSession.type.toUpperCase()}
                  </span>
                </>
              )}
            </div>

            {/* 右侧：退出沉浸 + 设置 + 窗口控制 */}
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="rounded-sm p-1.5 text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
                onClick={() => setViewMode("normal")}
                aria-label={t("退出沉浸模式")}
                title={t("退出沉浸模式")}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded-sm p-1.5 text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
                onClick={() => openSettings()}
                aria-label={t("设置")}
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded-sm p-1.5 text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
                onClick={() => {
                  void appWindow.minimize();
                }}
                aria-label={t("最小化")}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded-sm p-1.5 text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
                onClick={() => {
                  void handleToggleMaximize();
                }}
                aria-label={isMaximized ? t("还原") : t("最大化")}
              >
                {isMaximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
              </button>
              <button
                type="button"
                className="rounded-sm p-1.5 text-muted-foreground/70 transition-colors hover:bg-destructive/20 hover:text-destructive"
                onClick={() => {
                  void appWindow.close();
                }}
                aria-label={t("关闭")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
