import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SessionModule } from "../modules/SessionModule";
import { HistoryModule } from "../modules/HistoryModule";
import { Server, Clock } from "lucide-react";

export function LeftSlot() {
  const [activeModule, setActiveModule] = useState<"session" | "history">("session");

  return (
    <div className="h-full flex">
      {/* 模块导航栏 */}
      <div className="w-12 bg-muted flex flex-col items-center py-2 border-r">
        <Button
          variant={activeModule === "session" ? "secondary" : "ghost"}
          size="icon"
          className="mb-2"
          onClick={() => setActiveModule("session")}
        >
          <Server className="h-4 w-4" />
        </Button>
        <Button
          variant={activeModule === "history" ? "secondary" : "ghost"}
          size="icon"
          className="mb-2"
          onClick={() => setActiveModule("history")}
        >
          <Clock className="h-4 w-4" />
        </Button>
      </div>

      {/* 模块内容区 */}
      <div className="flex-1 overflow-hidden">
        {activeModule === "session" && <SessionModule />}
        {activeModule === "history" && <HistoryModule />}
      </div>
    </div>
  );
}