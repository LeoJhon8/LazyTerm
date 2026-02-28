import { Search, Clock } from "lucide-react";

export function HistoryModule() {
  const historyItems = [
    { command: "ls -la", time: "2分钟前", cwd: "/home/user" },
    { command: "git status", time: "5分钟前", cwd: "/projects/app" },
    { command: "npm run dev", time: "10分钟前", cwd: "/projects/app" },
    { command: "cd ..", time: "15分钟前", cwd: "/home" },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b">
        <h3 className="font-medium mb-3">历史命令</h3>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索历史命令..."
            className="w-full pl-8 pr-3 py-2 text-sm border rounded-md bg-background"
          />
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {historyItems.map((item, index) => (
          <div 
            key={index}
            className="p-3 border-b hover:bg-muted/50 cursor-pointer transition-colors"
          >
            <div className="flex items-start justify-between">
              <code className="text-sm font-mono break-all">{item.command}</code>
              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0 ml-2" />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {item.time} • {item.cwd}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}