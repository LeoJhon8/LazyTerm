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
      <div className="module-empty">
        <div className="module-empty-card">
          <p className="text-sm font-medium text-foreground">底部区域未配置模块</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 h-full px-0 py-0">
      <Component />
    </div>
  );
}