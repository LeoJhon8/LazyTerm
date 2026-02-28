import { useTabsStore } from "@/store/tabs";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";

export function TabBar() {
  // 1. 在解构时，将 Store 的属性名重命名为组件内使用的变量名
  const { 
    sessions: tabs,               // sessions -> tabs
    activeSessionId: activeTabId, // activeSessionId -> activeTabId
    setActiveSession: setActiveTab, // setActiveSession -> setActiveTab
    removeSession: removeTab,     // removeSession -> removeTab
    addSession: addTab            // addSession -> addTab
  } = useTabsStore();

  const handleAddTab = () => {
    addTab({
      title: `Local-${Date.now()}`,
      type: "local",
      cwd: typeof process !== 'undefined' ? process.cwd() : '/', // 增加环境检查
    });
  };

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeTab(id);
  };

  return (
    <div className="h-full flex items-center px-2">
      <div className="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={tab.id === activeTabId ? "secondary" : "ghost"}
            size="sm"
            className={`h-8 px-3 relative group flex items-center min-w-20 ${
              tab.id === activeTabId ? "bg-secondary" : "hover:bg-muted"
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="text-xs truncate max-w-[120px]">{tab.title}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 ml-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
              onClick={(e) => handleCloseTab(e, tab.id)}
            >
              <X className="h-2 w-2" />
            </Button>
          </Button>
        ))}
      </div>
      
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 ml-2 flex-shrink-0"
        onClick={handleAddTab}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}