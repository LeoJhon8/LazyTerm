import { useMemo, useState } from "react";
import { useHistoryStore } from "@/store/history";
import { useTabsStore } from "@/store/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Clock, Trash2, Search, X } from "lucide-react";

export function HistoryModule() {
  const { activeSessionId } = useTabsStore();
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

  // 发送命令到当前终端
  const sendCommand = (command: string) => {
    const activeSession = useTabsStore.getState().sessions.find(
      (s) => s.id === activeSessionId
    );
    if (activeSession?.connector?.isConnected) {
      activeSession.connector.write(command + "\r");
    }
  };

  return (
    <div className="flex flex-col h-full w-full max-w-full overflow-hidden bg-background border-l">
      {/* 头部区域 */}
      <div className="p-3 border-b space-y-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-sm truncate text-foreground/90">历史命令</span>
          </div>
          {commands.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive transition-colors"
              onClick={() => clearCommands()}
              title="清空所有历史"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        
        {/* 搜索框 */}
        <div className="relative group">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <Input
            placeholder="搜索历史记录..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs bg-muted/30 focus-visible:ring-1"
          />
        </div>
      </div>

      {/* 列表区域 */}
      <div className="flex-1 min-h-0 w-full overflow-hidden">
        <ScrollArea className="h-full w-full">
          <div className="p-2 space-y-0.5">
            {filteredCommands.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-[11px]">
                {searchQuery ? "未找到匹配命令" : "暂无历史记录"}
              </div>
            ) : (
              filteredCommands.map((cmd) => (
                <div
                  key={cmd.id}
                  className="group relative flex items-center gap-2 p-2 rounded-md hover:bg-accent cursor-pointer transition-all w-full overflow-hidden"
                  onClick={() => sendCommand(cmd.command)}
                  title={`点击执行: ${cmd.command}\n时间: ${new Date(cmd.timestamp).toLocaleString()}`}
                >
                  {/* 命令文本：w-0 flex-1 配合 truncate 确保不撑开容器 */}
                  <div className="w-0 flex-1">
                    <code className="block text-xs font-mono truncate text-foreground/70 group-hover:text-foreground">
                      {cmd.command}
                    </code>
                  </div>

                  {/* 删除按钮：flex-shrink-0 确保不被挤压，hover时显示 */}
                  <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-destructive/15 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation(); // 阻止触发整行的 sendCommand
                        removeCommand(cmd.id);
                      }}
                      title="删除此条"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* 底部状态栏 */}
      <div className="p-2 px-3 border-t text-[10px] text-muted-foreground bg-muted/10 flex-shrink-0 flex justify-between items-center">
        <span className="truncate">共 {filteredCommands.length} 条</span>
        <span className="opacity-50">点击命令发送</span>
      </div>
    </div>
  );
}