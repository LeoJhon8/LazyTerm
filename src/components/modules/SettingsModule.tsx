import { useSettingsStore } from "@/store/settings";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

export function SettingsModule() {
  const {
    theme,
    fontSize,
    fontFamily,
    setTheme,
    setFontSize,
    setFontFamily,
  } = useSettingsStore();

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b">
        <h3 className="font-medium">设置</h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="space-y-3">
          <Label>主题</Label>
          <Select value={theme} onValueChange={setTheme}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">浅色</SelectItem>
              <SelectItem value="dark">深色</SelectItem>
              <SelectItem value="system">跟随系统</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <Label>字体大小: {fontSize}px</Label>
          <Slider
            value={[fontSize]}
            onValueChange={(values: number[]) => setFontSize(values[0])}
            min={10}
            max={24}
            step={1}
          />
        </div>

        <div className="space-y-3">
          <Label>字体族</Label>
          <Select value={fontFamily} onValueChange={setFontFamily}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monospace">Monospace</SelectItem>
              <SelectItem value="'Courier New', Courier, monospace">Courier New</SelectItem>
              <SelectItem value="'Consolas', monospace">Consolas</SelectItem>
              <SelectItem value="'JetBrains Mono', monospace">JetBrains Mono</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}