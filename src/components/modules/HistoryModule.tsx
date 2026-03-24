import { useMemo, useState } from "react";
import { useHistoryStore } from "@/store/history";
import { useTabsStore } from "@/store/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Search, X } from "lucide-react";
import type { ITerminalConnector, SessionConnector } from "@/types/terminal";

function isTerminalConnector(connector: SessionConnector | undefined): connector is ITerminalConnector {
  return connector !== undefined && connector.protocol !== "rdp" && connector.protocol !== "vnc";
}

export function HistoryModule() {
  const { focusSessionId } = useTabsStore();
  const commands = useHistoryStore((state) => state.commands);
  const clearCommands = useHistoryStore((state) => state.clearCommands);
  const removeCommand = useHistoryStore((state) => state.removeCommand);
  const [searchQuery, setSearchQuery] = useState("");

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
            <span className="module-heading truncate text-[15px]">历史命令</span>
          </div>
        </div>
        {commands.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 rounded-xl p-0 text-muted-foreground transition-colors hover:text-destructive"
            onClick={() => clearCommands()}
            title="清空所有历史"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* 搜索框区域 */}
        <div className="shrink-0 px-2.5 pt-0.5 pb-2">
        <div className="relative group">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <Input
            placeholder="搜索历史记录..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 rounded-none border-border/70 bg-background/72 pl-8 text-[10px]"
          />
        </div>
      </div>

      {/* 列表区域 */}
      <div className="flex-1 min-h-0 w-full overflow-hidden">
        <ScrollArea className="h-full w-full overflow-x-hidden">
          <div className="px-0 py-1">
            {filteredCommands.length === 0 ? (
              <div className="module-empty py-12">
                <div className="module-empty-card">
                  <Search className="h-5 w-5" />
                  <p className="text-sm font-medium text-foreground">
                    {searchQuery ? "未找到匹配命令" : "暂无历史记录"}
                  </p>
                  <p className="text-xs">按回车执行的命令会自动记录到这里。</p>
                </div>
              </div>
            ) : (
              filteredCommands.map((cmd) => (
                <div
                  key={cmd.id}
                  className="group relative flex h-7 w-full items-center gap-1 overflow-hidden border-y border-transparent bg-transparent px-3 py-0.5 transition-colors hover:border-border/60 hover:bg-background/40"
                  onClick={() => sendCommand(cmd.command)}
                  title={`点击执行: ${cmd.command}`}
                >
                  {/* 命令文本：w-0 flex-1 配合 truncate 确保不撑开容器 */}
                  <div className="w-0 flex-1">
                    <code className="block truncate font-mono text-[10px] leading-none text-foreground/75 group-hover:text-foreground">
                      {cmd.command}
                    </code>
                  </div>

                  {/* 删除按钮：flex-shrink-0 确保不被挤压，hover时显示 */}
                  <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 rounded-none p-0 hover:bg-destructive/15 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation(); // 阻止触发整行的 sendCommand
                        removeCommand(cmd.id);
                      }}
                      title="删除此条"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

    </div>
  );
}
