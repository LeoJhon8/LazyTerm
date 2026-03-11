import { useSlotConfigStore } from "@/store/slot-config";
import { QuickCmdBar } from "@/components/modules/QuickCmdBar";

const MODULE_COMPONENTS: Record<string, React.ComponentType> = {
  QuickCmdModule: QuickCmdBar,
};

export function BottomSlot() {
  const { currentConfig } = useSlotConfigStore();
  const { module } = currentConfig.bottom;
  
  const Component = MODULE_COMPONENTS[module];

  if (!Component) {
    return (
      <div className="h-full flex items-center px-4 text-sm text-muted-foreground">
        未配置模块
      </div>
    );
  }

  return (
    <div className="relative z-10 h-full p-2">
      <Component />
    </div>
  );
}