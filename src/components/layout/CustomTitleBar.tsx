import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X, Settings } from "lucide-react";
import { useTabsStore } from "@/store/tabs";
import { useSettingsDialogStore } from "@/store/settings-dialog";
import { useI18n } from "@/i18n";
import logo32 from "../../../src-tauri/icons/LazyTerm-32.png";
import logo128 from "../../../src-tauri/icons/LazyTerm-128.png";
import logo256 from "../../../src-tauri/icons/LazyTerm-256.png";

const appWindow = getCurrentWindow();

export function CustomTitleBar() {
  const { t } = useI18n();
  const { focusSessionId, sessions } = useTabsStore();
  const openSettings = useSettingsDialogStore((s) => s.openSettings);
  const [isMaximized, setIsMaximized] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const focusSession = useMemo(
    () => sessions.find((session) => session.id === focusSessionId),
    [focusSessionId, sessions],
  );

  useEffect(() => {
    let cancelled = false;

    const syncMaximizedState = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        if (!cancelled) {
          setIsMaximized(maximized);
        }
      } catch {
        // no-op: window state sync failure should not block the UI
      }
    };

    syncMaximizedState();

    const unlistenResizedPromise = appWindow.onResized(() => {
      void syncMaximizedState();
    });

    return () => {
      cancelled = true;
      void unlistenResizedPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleToggleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };

  return (
    <header className="window-titlebar">
      <div
        className="window-titlebar__drag-region"
        onDoubleClick={() => {
          void handleToggleMaximize();
        }}
      >
        <div className="window-titlebar__brand">
          <div className="window-titlebar__logo" aria-hidden="true">
            {!logoError ? (
              <img
                className="window-titlebar__logo-img"
                src={logo128}
                srcSet={`${logo32} 32w, ${logo128} 128w, ${logo256} 256w`}
                sizes="36px"
                alt="LazyTerm"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  if (target.src === (logo128 as unknown as string)) {
                    target.src = logo256 as unknown as string;
                  } else if (target.src === (logo256 as unknown as string)) {
                    setLogoError(true);
                  } else {
                    setLogoError(true);
                  }
                }}
              />
            ) : (
              "LT"
            )}
          </div>
          <div className="window-titlebar__titles">
            <span className="window-titlebar__app-name">LazyTerm</span>
            <span className="window-titlebar__session-name">
              {focusSession ? focusSession.title : t("无活动会话")}
            </span>
          </div>
        </div>

        <div className="window-titlebar__meta" data-tauri-drag-region>
          <span className="window-titlebar__meta-pill">
            {focusSession
              ? focusSession.type === "local"
                ? t("本地终端")
                : focusSession.type === "ssh"
                  ? "SSH"
                  : focusSession.type === "rdp"
                    ? "RDP"
                    : "VNC"
              : t("开始桌面")}
          </span>
        </div>
      </div>

      <div className="window-titlebar__controls" aria-label={t("窗口控制")}>
        <button
          type="button"
          className="window-titlebar__control window-titlebar__control--neutral"
          onClick={() => openSettings()}
          aria-label={t("设置")}
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="window-titlebar__control window-titlebar__control--neutral"
          onClick={() => {
            void appWindow.minimize();
          }}
          aria-label={t("最小化")}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="window-titlebar__control window-titlebar__control--neutral"
          onClick={() => {
            void handleToggleMaximize();
          }}
          aria-label={isMaximized ? t("还原") : t("最大化")}
        >
          {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          className="window-titlebar__control window-titlebar__control--danger"
          onClick={() => {
            void appWindow.close();
          }}
          aria-label={t("关闭")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
