import { useTabsStore } from "@/store/tabs";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";
import { useSettingsStore } from "@/store/settings";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

interface ShellInfo {
  name: string;
  path: string;
  icon_type: string;
}

export function TabBar() {
  const { 
    sessions: tabs,               
    activeSessionId: activeTabId, 
    setActiveSession: setActiveTab, 
    removeSession: removeTab,     
    addSession: addTab            
  } = useTabsStore();

  const { defaultShell } = useSettingsStore();
  const [shells, setShells] = useState<ShellInfo[]>([]);

  useEffect(() => {
    invoke<ShellInfo[]>("get_available_shells")
      .then(setShells)
      .catch(console.error);
  }, []);

  const handleAddTab = () => {
    // 根据 defaultShell 找到友好的名称作为标题
    const shellInfo = shells.find(s => s.path === defaultShell || s.name.toLowerCase() === defaultShell.toLowerCase());
    const title = shellInfo ? shellInfo.name : (defaultShell.includes('powershell') ? 'PowerShell' : (defaultShell.includes('cmd') ? 'CMD' : 'Terminal'));
    
    addTab({
      title,
      type: "local",
      cwd: typeof process !== 'undefined' ? process.cwd() : '/',
      config: {
        shell: defaultShell
      }
    });
  };

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // 这里你已经做得很好了，防止触发外层的 setActiveTab
    removeTab(id);
  };

  return (
    <div className="h-full flex items-center px-2">
      <div className="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          /* 修复方案：将外层的 Button 改为 div */
          <div
            key={tab.id}
            role="button" // 增加语义，告诉浏览器这是个可交互的按钮
            tabIndex={0}  // 让 div 可以被 Tab 键选中
            className={`h-8 px-3 relative group flex items-center min-w-20 cursor-pointer rounded-md transition-colors text-sm font-medium ${
              tab.id === activeTabId 
                ? "bg-secondary text-secondary-foreground" 
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="text-xs truncate max-w-120 pointer-events-none">
              {tab.title}
            </span>
            
            {/* 内部按钮保持不变，现在它不再嵌套在 button 里了 */}
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 ml-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
              onClick={(e) => handleCloseTab(e, tab.id)}
            >
              <X className="h-2 w-2" />
            </Button>
          </div>
        ))}
      </div>
      
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 ml-2 shrink-0"
        onClick={handleAddTab}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}