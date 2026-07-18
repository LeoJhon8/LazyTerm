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
    return null;
  }

  return (
    <div className="relative z-10 h-full px-0 py-0">
      <Component />
    </div>
  );
}
