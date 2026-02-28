import { useTabsStore } from "@/store/tabs";
import { TabBar } from "../modules/TabBar";

export function TopSlot() {
  // 1. 将 tabs 改为 sessions，并推荐使用 Selector 模式
  const sessions = useTabsStore((state) => state.sessions);

  // 2. 这里的逻辑同步修改为 sessions.length
  if (sessions.length === 0) {
    return (
      <div className="h-full flex items-center px-4 text-sm text-muted-foreground">
        欢迎使用 Lazy Terminal
      </div>
    );
  }

  return (
    <div className="h-full">
      <TabBar />
    </div>
  );
}