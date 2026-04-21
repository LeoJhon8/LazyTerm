import { useEffect, useCallback } from "react";
import { useSettingsStore, type ViewMode } from "@/store/settings";
import { useTabsStore } from "@/store/tabs";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";

/**
 * 视图模式快捷键 & 状态管理 hook
 *
 * - F11: 切换沉浸模式（normal ↔ immersive，或 focus → immersive）
 * - Ctrl+Shift+F: 切换专注模式（normal ↔ focus，或 immersive → focus）
 * - 所有会话关闭时自动回到 normal
 */
export function useViewMode() {
  const { viewMode, setSettings } = useSettingsStore();
  const sessionCount = useTabsStore((s) => s.sessions.length);

  // 注册全局快捷键
  useEffect(() => {
    const IMMERSIVE_SHORTCUT = "F11";
    const FOCUS_SHORTCUT = "CommandOrControl+Shift+F";

    const handleImmersiveShortcut = (event: { state: string }) => {
      if (event.state === "Pressed") {
        const current = useSettingsStore.getState().viewMode;
        const next: ViewMode = current === "immersive" ? "normal" : "immersive";
        setSettings({ viewMode: next });
      }
    };

    const handleFocusShortcut = (event: { state: string }) => {
      if (event.state === "Pressed") {
        const current = useSettingsStore.getState().viewMode;
        const next: ViewMode = current === "focus" ? "normal" : "focus";
        setSettings({ viewMode: next });
      }
    };

    const setup = async () => {
      const fallbacks: (() => void)[] = [];

      try {
        await register(IMMERSIVE_SHORTCUT, handleImmersiveShortcut);
      } catch (err) {
        // 回退到 JS keydown
        console.warn("[view-mode] F11 global-shortcut 注册失败，回退到 keydown:", err);
        const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === "F11") {
            e.preventDefault();
            handleImmersiveShortcut({ state: "Pressed" });
          }
        };
        window.addEventListener("keydown", handleKeyDown);
        fallbacks.push(() => window.removeEventListener("keydown", handleKeyDown));
      }

      try {
        await register(FOCUS_SHORTCUT, handleFocusShortcut);
      } catch (err) {
        console.warn("[view-mode] Ctrl+Shift+F global-shortcut 注册失败，回退到 keydown:", err);
        const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === "F" && e.ctrlKey && e.shiftKey) {
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
    const promise = setup().then((cleanups) => {
      fallbackCleanups = cleanups ?? [];
    });

    return () => {
      void promise.then(() => {
        void unregister(IMMERSIVE_SHORTCUT);
        void unregister(FOCUS_SHORTCUT);
        fallbackCleanups.forEach((fn) => fn());
      });
    };
  }, [setSettings]);

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
