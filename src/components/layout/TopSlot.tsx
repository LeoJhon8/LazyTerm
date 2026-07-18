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
    return null;
  }

  return (
    <div className="h-full px-0 py-0">
      <Component />
    </div>
  );
}
