import { useMemo, useState } from "react";
import { useHistoryStore } from "@/store/history";
import { useTabsStore } from "@/store/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Clock, Trash2, Send, Search, X } from "lucide-react";

export function HistoryModule() {
  const { activeSessionId } = useTabsStore();
  const commands = useHistoryStore((state) => state.commands);
  const clearCommands = useHistoryStore((state) => state.clearCommands);
  const removeCommand = useHistoryStore((state) => state.removeCommand);
  const [searchQuery, setSearchQuery] = useState("");
  
  // 调试日志
  console.log("[HistoryModule] Commands count:", commands.length);
  console.log("[HistoryModule] Commands:", commands);

  // 搜索过滤
  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) return commands;
    return commands.filter((cmd) =>
      cmd.command.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [commands, searchQuery]);

  // 发送命令到当前终端
  const sendCommand = (command: string) => {
    const activeSession = useTabsStore.getState().sessions.find(
      (s) => s.id === activeSessionId
    );
    if (activeSession?.connector && activeSession.connector.isConnected) {
      activeSession.connector.write(command + "\r");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">历史命令</span>
          </div>
          {commands.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => clearCommands()}
              title="清空历史"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
        
        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="搜索历史命令..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 py-2 text-sm"
          />
        </div>
      </div>

      {/* 命令列表 */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {filteredCommands.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">
              {searchQuery ? "未找到匹配的命令" : "暂无历史命令"}
            </div>
          ) : (
            filteredCommands.map((cmd) => (
              <div
                key={cmd.id}
                className="group flex items-center gap-1 p-2 rounded-md hover:bg-accent cursor-pointer"
                onClick={() => sendCommand(cmd.command)}
                title={new Date(cmd.timestamp).toLocaleString()}
              >
                <code className="flex-1 text-xs font-mono truncate">
                  {cmd.command}
                </code>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 hover:bg-destructive hover:text-destructive-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      sendCommand(cmd.command);
                    }}
                    title="发送命令"
                  >
                    <Send className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 hover:bg-destructive hover:text-destructive-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCommand(cmd.id);
                    }}
                    title="删除命令"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* 底部统计 */}
      <div className="p-2 border-t text-xs text-muted-foreground flex items-center justify-between">
        <span>共 {filteredCommands.length} 条记录</span>
        <span className="text-[10px]">点击命令 / 悬浮删除</span>
      </div>
    </div>
  );
}
