import { useEffect, useState } from "react";
import {
  FolderOpen,
  History,
  ListChecks,
  Send,
  Settings2,
  TerminalSquare,
} from "lucide-react";

import { PaneContainer } from "@/components/layout/PaneContainer";
import { HistoryModule } from "@/components/modules/HistoryModule";
import { QuickCommandManagerDialog } from "@/components/modules/QuickCommandManagerDialog";
import { SessionModule } from "@/components/modules/SessionModule";
import { TabBar } from "@/components/modules/TabBar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n";
import { emitTerminalCommandSubmitted } from "@/lib/terminal-command-events";
import { cn } from "@/lib/utils";
import { useQuickCommandsStore } from "@/store/quick-commands";
import { useSettingsStore } from "@/store/settings";
import { useSettingsDialogStore } from "@/store/settings-dialog";
import { useTabsStore } from "@/store/tabs";
import type { ITerminalConnector, SessionConnector } from "@/types/terminal";

type MobilePanel = "sessions" | "history" | "commands" | null;

function isTerminalConnector(connector: SessionConnector | undefined): connector is ITerminalConnector {
  return connector !== undefined && connector.protocol !== "rdp" && connector.protocol !== "vnc";
}

export function MobileAppShell() {
  const { t } = useI18n();
  const [activePanel, setActivePanel] = useState<MobilePanel>(null);
  const [commandManagerOpen, setCommandManagerOpen] = useState(false);
  const commands = useQuickCommandsStore((state) => state.commands);
  const mobileHistoryVisible = useSettingsStore((state) => state.mobileHistoryVisible);
  const mobileQuickCommandsVisible = useSettingsStore((state) => state.mobileQuickCommandsVisible);
  const mobileTerminalKeysVisible = useSettingsStore((state) => state.mobileTerminalKeysVisible);
  const focusSessionId = useTabsStore((state) => state.focusSessionId);
  const focusSession = useTabsStore((state) => (
    state.sessions.find((session) => session.id === state.focusSessionId)
  ));
  const openSettings = useSettingsDialogStore((state) => state.openSettings);
  const connector = focusSession?.connector;
  const canWrite = !!connector?.isConnected && isTerminalConnector(connector);

  useEffect(() => {
    setActivePanel((current) => {
      if (current === "history" && !mobileHistoryVisible) return null;
      if (current === "commands" && !mobileQuickCommandsVisible) return null;
      return current;
    });
    if (!mobileQuickCommandsVisible) setCommandManagerOpen(false);
  }, [mobileHistoryVisible, mobileQuickCommandsVisible]);

  const writeToTerminal = (data: string) => {
    if (!canWrite || !isTerminalConnector(connector)) return;
    connector.write(data);
    window.dispatchEvent(new Event("lazy-term-focus"));
  };

  const runCommand = (command: string) => {
    if (!focusSessionId || !canWrite) return;
    emitTerminalCommandSubmitted(focusSessionId, command);
    writeToTerminal(`${command}\r`);
    setActivePanel(null);
  };

  const allNavItems: Array<{
    id: Exclude<MobilePanel, null> | "terminal";
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "terminal", label: t("终端"), icon: TerminalSquare },
    { id: "sessions", label: t("会话"), icon: FolderOpen },
    { id: "history", label: t("历史命令"), icon: History },
    { id: "commands", label: t("快捷命令"), icon: ListChecks },
  ];
  const navItems = allNavItems.filter(({ id }) => (
    (id !== "history" || mobileHistoryVisible)
    && (id !== "commands" || mobileQuickCommandsVisible)
  ));

  return (
    <div
      className={cn(
        "mobile-app-shell android-app",
        !mobileTerminalKeysVisible && "mobile-terminal-keys-hidden",
      )}
    >
      <header className="mobile-app-header">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-wide">LazyTerm</div>
          <div className="truncate text-[10px] text-muted-foreground">SSH</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-xl"
          onClick={() => openSettings()}
          aria-label={t("系统设置")}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </header>

      <div className="mobile-tabbar">
        <TabBar />
      </div>

      <main className="mobile-terminal-stage">
        <PaneContainer />

        {activePanel && (
          <aside className="mobile-workspace-panel">
            {activePanel === "sessions" && <SessionModule />}
            {activePanel === "history" && mobileHistoryVisible && <HistoryModule />}
            {activePanel === "commands" && mobileQuickCommandsVisible && (
              <div className="module-shell">
                <div className="module-header shrink-0 border-b-0">
                  <span className="module-heading truncate text-[15px]">{t("快捷命令")}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setCommandManagerOpen(true)}>
                    {t("管理快捷命令")}
                  </Button>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="grid gap-2 p-3">
                    {commands.length === 0 ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">{t("暂无快捷命令")}</div>
                    ) : commands.map((command) => (
                      <Button
                        key={command.id}
                        type="button"
                        variant="outline"
                        className="h-auto min-h-12 justify-between gap-3 px-4 py-3 text-left"
                        disabled={!canWrite}
                        onClick={() => runCommand(command.command)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{command.label}</span>
                          <code className="block truncate text-[11px] text-muted-foreground">{command.command}</code>
                        </span>
                        <Send className="h-4 w-4 shrink-0" />
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
                {!canWrite && (
                  <div className="border-t border-border/55 px-4 py-2 text-center text-xs text-muted-foreground">
                    {t("当前终端未连接")}
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </main>

      {mobileTerminalKeysVisible && (
        <div className="mobile-terminal-keys" aria-label={t("发送常用按键")}>
          {[
            ["Esc", "\u001b"],
            ["Tab", "\t"],
            ["Ctrl+C", "\u0003"],
            ["Ctrl+D", "\u0004"],
            ["←", "\u001b[D"],
            ["↑", "\u001b[A"],
            ["↓", "\u001b[B"],
            ["→", "\u001b[C"],
          ].map(([label, data]) => (
            <button key={label} type="button" disabled={!canWrite} onClick={() => writeToTerminal(data)}>
              {label}
            </button>
          ))}
        </div>
      )}

      <nav className="mobile-bottom-nav">
        {navItems.map(({ id, label, icon: Icon }) => {
          const active = id === "terminal" ? activePanel === null : activePanel === id;
          return (
            <button
              key={id}
              type="button"
              className={cn("mobile-bottom-nav-item", active && "is-active")}
              onClick={() => {
                if (id === "terminal") setActivePanel(null);
                else setActivePanel((current) => current === id ? null : id);
              }}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <QuickCommandManagerDialog open={commandManagerOpen} onOpenChange={setCommandManagerOpen} />
    </div>
  );
}
