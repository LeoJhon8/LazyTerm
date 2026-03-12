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
      <div className="module-empty">
        <div className="module-empty-card">
          <p className="text-sm font-medium text-foreground">顶部区域未配置模块</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full px-0 py-0">
      <Component />
    </div>
  );
}