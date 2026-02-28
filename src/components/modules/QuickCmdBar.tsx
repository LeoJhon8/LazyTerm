import { Button } from "@/components/ui/button";
import { Play, RotateCcw, Copy } from "lucide-react";

const quickCommands = [
  { label: "清屏", command: "clear", icon: RotateCcw },
  { label: "列出文件", command: "ls -la", icon: Copy },
  { label: "当前路径", command: "pwd", icon: Copy },
  { label: "进程列表", command: "ps aux", icon: Copy },
];

export function QuickCmdBar() {
  const handleCommandClick = (command: string) => {
    // 这里应该发送命令到当前激活的终端
    console.log("Executing command:", command);
  };

  return (
    <div className="flex items-center gap-2 h-full">
      <Play className="h-4 w-4 text-muted-foreground" />
      <div className="flex gap-2 overflow-x-auto">
        {quickCommands.map((cmd, index) => (
          <Button
            key={index}
            variant="outline"
            size="sm"
            className="h-7 text-xs whitespace-nowrap"
            onClick={() => handleCommandClick(cmd.command)}
          >
            <cmd.icon className="h-3 w-3 mr-1" />
            {cmd.label}
          </Button>
        ))}
      </div>
    </div>
  );
}