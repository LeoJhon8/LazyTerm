import { useMemo, useState } from "react";
import { useHistoryStore } from "@/store/history";
import { useTabsStore } from "@/store/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Search, X, Send } from "lucide-react";
import type { ITerminalConnector, SessionConnector } from "@/types/terminal";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

function isTerminalConnector(connector: SessionConnector | undefined): connector is ITerminalConnector {
  return connector !== undefined && connector.protocol !== "rdp" && connector.protocol !== "vnc";
}

export function HistoryModule() {
  const { t } = useI18n();
  const { focusSessionId, getAllConnectors } = useTabsStore();
  const commands = useHistoryStore((state) => state.commands);
  const clearCommands = useHistoryStore((state) => state.clearCommands);
  const removeCommand = useHistoryStore((state) => state.removeCommand);
  const [searchQuery, setSearchQuery] = useState("");
  const [sendToAllState, setSendToAllState] = useState<{ open: boolean; command: string }>({ open: false, command: "" });
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  // 搜索过滤
  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) return commands;
    return commands.filter((cmd) =>
      cmd.command.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [commands, searchQuery]);

  // 发送命令到焦点会话的终端
  const sendCommand = (command: string) => {
    const focusSession = useTabsStore.getState().sessions.find(
      (s) => s.id === focusSessionId
    );
    if (focusSession?.connector?.isConnected && isTerminalConnector(focusSession.connector)) {
      focusSession.connector.write(command + "\r");
    }
  };

  return (
    <div className="module-shell">
      {/* 头部区域 */}
      <div className="module-header shrink-0 border-b-0">
        <div className="module-title overflow-hidden">
          <div className="module-title-text overflow-hidden">
            <span className="module-heading truncate text-[15px]">{t("历史命令")}</span>
          </div>
        </div>
        <div className={cn("history-header-actions", searchQuery && "history-header-actions--searching")}>
          <div className={cn("history-header-search", searchQuery && "history-header-search--active")}>
            <Search className="history-header-search-icon" />
            <Input
              placeholder=""
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="history-header-search-input"
            />
          </div>
        {commands.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="history-header-action-button hover:text-destructive"
            onClick={() => setClearConfirmOpen(true)}
            title={t("清空所有历史")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
        </div>
      </div>

      {/* 搜索框区域 */}
      {/* 列表区域 */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden">
        <ScrollArea className="h-full w-full overflow-x-hidden">
          <div className="px-0 py-1">
            {filteredCommands.length > 0 && filteredCommands.map((cmd) => (
                <div
                  key={cmd.id}
                  className="group relative flex h-7 w-full items-center gap-1 overflow-hidden rounded-md border-y border-transparent bg-transparent px-3 py-0.5 transition-colors hover:bg-accent/50"
                  onClick={() => sendCommand(cmd.command)}
                  title={t("点击执行: {command}", { command: cmd.command })}
                >
                  {/* 命令文本：w-0 flex-1 配合 truncate 确保不撑开容器 */}
                  <div className="w-0 flex-1">
                    <code className="block truncate font-mono text-[10px] leading-none text-foreground/75 group-hover:text-foreground">
                      {cmd.command}
                    </code>
                  </div>

                  {/* 操作按钮：hover时显示 */}
                  <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 rounded-sm p-0 hover:bg-accent/80 hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSendToAllState({ open: true, command: cmd.command });
                      }}
                      title={t("发送到全部")}
                    >
                      <Send className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 rounded-sm p-0 hover:bg-destructive/20 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation(); // 阻止触发整行的 sendCommand
                        removeCommand(cmd.id);
                      }}
                      title={t("删除此条")}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        </ScrollArea>
      </div>

      {/* 发送到全部确认弹窗 */}
      <AlertDialog open={sendToAllState.open} onOpenChange={(open) => !open && setSendToAllState({ open: false, command: "" })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("发送到全部")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("确认将此命令发送到所有标签页？")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSendToAllState({ open: false, command: "" })}>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const connectors = getAllConnectors();
              connectors.forEach((connector) => {
                if (connector.isConnected) {
                  connector.write(sendToAllState.command + "\r");
                }
              });
              setSendToAllState({ open: false, command: "" });
            }}>{t("确认发送")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 清空历史确认弹窗 */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={(open) => { if (!open) setClearConfirmOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("清空所有历史")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("清空所有历史命令？此操作不可恢复。")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setClearConfirmOpen(false)}>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onClick={() => { clearCommands(); setClearConfirmOpen(false); }}>{t("确认清空")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
