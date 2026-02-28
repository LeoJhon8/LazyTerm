import { useEffect } from "react";
import { useSettingsStore } from "@/store/settings";
import { TerminalView } from "@/components/terminal/TerminalView";
import { SlotManager } from "@/components/layout/SlotManager";

function App() {
  const { theme } = useSettingsStore();

  // 设置主题
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.toggle("dark", systemTheme === "dark");
    } else {
      root.classList.toggle("dark", theme === "dark");
    }
  }, [theme]);

  return (
    <div 
      id="lazy-terminal-root"
      className="h-screen w-screen overflow-hidden bg-background text-foreground"
    >
      <SlotManager />
      <TerminalView />
    </div>
  );
}

export default App;