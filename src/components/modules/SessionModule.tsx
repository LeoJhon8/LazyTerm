import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, FolderPlus, Server, Terminal } from "lucide-react";
import { useTabsStore } from "@/store/tabs";
import { homeDir } from '@tauri-apps/api/path';


export function SessionModule() {
  const { addSession } = useTabsStore();
  const [open, setOpen] = useState(false);
  const handleCreateLocalSession = async () => {
    const home = await homeDir();
    addSession({
      title: `Local-${Date.now()}`,
      type: "local",
      cwd: home,
    });
    setOpen(false);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-medium">会话管理</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" />
              新建
            </Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>新建会话</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <Button 
                variant="outline" 
                className="justify-start"
                onClick={handleCreateLocalSession}
              >
                <Terminal className="h-4 w-4 mr-2" />
                本地终端
              </Button>
              <Button variant="outline" className="justify-start" disabled>
                <Server className="h-4 w-4 mr-2" />
                SSH连接 (开发中)
              </Button>
              <Button variant="outline" className="justify-start" disabled>
                <FolderPlus className="h-4 w-4 mr-2" />
                Telnet (开发中)
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-sm text-muted-foreground text-center py-8">
          暂无会话<br />
          点击上方按钮创建新会话
        </div>
      </div>
    </div>
  );
}