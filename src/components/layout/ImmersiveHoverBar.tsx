import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Minus, Square, X } from "lucide-react";
import { useTabsStore } from "@/store/tabs";
import { useSettingsStore } from "@/store/settings";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const appWindow = getCurrentWindow();

/** 鼠标在屏幕顶部多少像素内触发悬浮栏 */
const TRIGGER_ZONE_PX = 4;

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

  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const focusSession = useMemo(
    () => sessions.find((s) => s.id === focusSessionId),
    [focusSessionId, sessions],
  );

  // ─── 鼠标顶部区域检测 ───
  useEffect(() => {
    if (!immersiveShowTabStrip && !visible) return;

    const handleMouseMove = (e: MouseEvent) => {
      // 鼠标在屏幕最顶部
      if (e.clientY <= TRIGGER_ZONE_PX) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        setVisible(true);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [immersiveShowTabStrip, visible]);

  // ─── 鼠标离开悬浮栏后延迟隐藏 ───
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
    }, immersiveHoverBarDelay);
  }, [immersiveHoverBarDelay]);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  // ─── 窗口控制 ───
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        if (!cancelled) setIsMaximized(await appWindow.isMaximized());
      } catch { /* 忽略 */ }
    };
    sync();
    const promise = appWindow.onResized(() => { void sync(); });
    return () => {
      cancelled = true;
      void promise.then((fn) => fn());
    };
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  }, []);

  // ─── 标签切换 ───
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
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {/* 悬浮标签条 */}
          {immersiveShowTabStrip && tabs.length > 1 && (
            <div
              className={cn(
                "flex h-7 items-center gap-0.5 px-2 pt-1",
                "bg-background/75 backdrop-blur-xl border-b border-border/30",
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
              "bg-background/80 backdrop-blur-xl border-b border-border/20",
            )}
            data-tauri-drag-region
          >
            {/* 左侧：品牌 + 会话信息 */}
            <div className="flex items-center gap-2 min-w-0" data-tauri-drag-region>
              <span className="text-xs font-semibold text-foreground/80 shrink-0">LazyTerm</span>
              {focusSession && (
                <>
                  <span className="text-muted-foreground/40 shrink-0">·</span>
                  <span className="text-xs text-muted-foreground truncate">
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

            {/* 右侧：窗口控制 */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                className="rounded-sm p-1.5 text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
                onClick={() => { void appWindow.minimize(); }}
                aria-label={t("最小化")}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded-sm p-1.5 text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
                onClick={() => { void handleToggleMaximize(); }}
                aria-label={isMaximized ? t("还原") : t("最大化")}
              >
                {isMaximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
              </button>
              <button
                type="button"
                className="rounded-sm p-1.5 text-muted-foreground/70 transition-colors hover:bg-destructive/20 hover:text-destructive"
                onClick={() => { void appWindow.close(); }}
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
