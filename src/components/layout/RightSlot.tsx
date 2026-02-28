import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsModule } from "../modules/SettingsModule";
import { PluginsModule } from "../modules/PluginsModule";
import { Settings, Puzzle } from "lucide-react";

export function RightSlot() {
  const [activeModule, setActiveModule] = useState<"settings" | "plugins">("settings");

  return (
    <div className="h-full flex">
      {/* 模块内容区 */}
      <div className="flex-1 overflow-hidden">
        {activeModule === "settings" && <SettingsModule />}
        {activeModule === "plugins" && <PluginsModule />}
      </div>

      {/* 模块导航栏 */}
      <div className="w-12 bg-muted flex flex-col items-center py-2 border-l">
        <Button
          variant={activeModule === "settings" ? "secondary" : "ghost"}
          size="icon"
          className="mb-2"
          onClick={() => setActiveModule("settings")}
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant={activeModule === "plugins" ? "secondary" : "ghost"}
          size="icon"
          className="mb-2"
          onClick={() => setActiveModule("plugins")}
        >
          <Puzzle className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}