import { useSlotConfigStore } from "@/store/slot-config";
import { TabBar } from "@/components/modules/TabBar";

const MODULE_COMPONENTS: Record<string, React.ComponentType> = {
  TabModule: TabBar,
};

export function TopSlot() {
  const { currentConfig } = useSlotConfigStore();
  const { module } = currentConfig.top;
  
  const Component = MODULE_COMPONENTS[module];

  if (!Component) {
    return (
      <div className="h-full flex items-center px-4 text-sm text-muted-foreground">
        未配置模块
      </div>
    );
  }

  return (
    <div className="h-full">
      <Component />
    </div>
  );
}