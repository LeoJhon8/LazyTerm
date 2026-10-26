import { useEffect, useCallback } from "react";
import { useSettingsStore, type ViewMode } from "@/store/settings";
import { useTabsStore } from "@/store/tabs";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_ANDROID } from "@/lib/platform";

// 等待上一次卸载完成，避免异步注销移除新挂载的快捷键。
let shortcutLifecycle: Promise<void> = Promise.resolve();

/**
 * 视图模式快捷键 & 状态管理 hook
 *
 * - F11: 切换沉浸模式（normal ↔ immersive，或 focus → immersive）
 * - Ctrl+Shift+F: 切换专注模式（normal ↔ focus，或 immersive → focus）
 * - 所有会话关闭时自动回到 normal
 */
export function useViewMode(enableShortcuts = false) {
  const { viewMode, setSettings } = useSettingsStore();
  const sessionCount = useTabsStore((s) => s.sessions.length);

  // 仅由 App 注册快捷键，读取视图状态的组件不重复注册。
  useEffect(() => {
    if (IS_ANDROID || !enableShortcuts) return;

    const IMMERSIVE_SHORTCUT = "F11";
    const FOCUS_SHORTCUT = "CommandOrControl+Shift+F";
    let disposed = false;
    const registeredShortcuts: string[] = [];

    const isWindowFocused = async () => {
      try {
        return !disposed && await getCurrentWindow().isFocused();
      } catch {
        return false;
      }
    };

    const handleImmersiveShortcut = async (event: { state: string }) => {
      if (event.state === "Pressed" && await isWindowFocused() && !disposed) {
        const current = useSettingsStore.getState().viewMode;
        const next: ViewMode = current === "immersive" ? "normal" : "immersive";
        setSettings({ viewMode: next });
      }
    };

    const handleFocusShortcut = async (event: { state: string }) => {
      if (event.state === "Pressed" && await isWindowFocused() && !disposed) {
        const current = useSettingsStore.getState().viewMode;
        const next: ViewMode = current === "focus" ? "normal" : "focus";
        setSettings({ viewMode: next });
      }
    };

    const setup = async () => {
      const fallbacks: (() => void)[] = [];
      if (disposed) return fallbacks;

      try {
        await register(IMMERSIVE_SHORTCUT, handleImmersiveShortcut);
        registeredShortcuts.push(IMMERSIVE_SHORTCUT);
      } catch (err) {
        // 回退到 JS keydown
        console.warn("[view-mode] F11 global-shortcut 注册失败，回退到 keydown:", err);
        const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === "F11" && !e.repeat && document.hasFocus()) {
            e.preventDefault();
            handleImmersiveShortcut({ state: "Pressed" });
          }
        };
        window.addEventListener("keydown", handleKeyDown);
        fallbacks.push(() => window.removeEventListener("keydown", handleKeyDown));
      }

      try {
        await register(FOCUS_SHORTCUT, handleFocusShortcut);
        registeredShortcuts.push(FOCUS_SHORTCUT);
      } catch (err) {
        console.warn("[view-mode] Ctrl+Shift+F global-shortcut 注册失败，回退到 keydown:", err);
        const handleKeyDown = (e: KeyboardEvent) => {
          const isMac = /Mac/i.test(navigator.platform);
          const commandPressed = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
          if (e.key.toLowerCase() === "f" && commandPressed && e.shiftKey && !e.altKey && !e.repeat && document.hasFocus()) {
            e.preventDefault();
            handleFocusShortcut({ state: "Pressed" });
          }
        };
        window.addEventListener("keydown", handleKeyDown);
        fallbacks.push(() => window.removeEventListener("keydown", handleKeyDown));
      }

      return fallbacks;
    };

    let fallbackCleanups: (() => void)[] = [];
    const promise = shortcutLifecycle.then(setup).then((cleanups) => {
      fallbackCleanups = cleanups ?? [];
    });
    shortcutLifecycle = promise;

    return () => {
      disposed = true;
      shortcutLifecycle = promise.then(async () => {
        fallbackCleanups.forEach((fn) => fn());
        await Promise.all(registeredShortcuts.map(async (shortcut) => {
          try {
            await unregister(shortcut);
          } catch (error) {
            console.warn("[view-mode] 快捷键注销失败:", shortcut, error);
          }
        }));
      });
    };
  }, [enableShortcuts, setSettings]);

  // 所有会话关闭 → 回到 normal
  useEffect(() => {
    if (viewMode !== "normal" && sessionCount === 0) {
      setSettings({ viewMode: "normal" });
    }
  }, [viewMode, sessionCount, setSettings]);

  const setViewMode = useCallback((mode: ViewMode) => {
    setSettings({ viewMode: mode });
  }, [setSettings]);

  const toggleImmersiveMode = useCallback(() => {
    const current = useSettingsStore.getState().viewMode;
    setSettings({ viewMode: current === "immersive" ? "normal" : "immersive" });
  }, [setSettings]);

  const toggleFocusMode = useCallback(() => {
    const current = useSettingsStore.getState().viewMode;
    setSettings({ viewMode: current === "focus" ? "normal" : "focus" });
  }, [setSettings]);

  return {
    viewMode,
    setViewMode,
    toggleImmersiveMode,
    toggleFocusMode,
    isImmersive: viewMode === "immersive",
    isFocus: viewMode === "focus",
    isNormal: viewMode === "normal",
  };
}
