import { Button } from "@/components/ui/button";
import { Download, Package, Star } from "lucide-react";

const plugins = [
  { name: "Git增强", description: "Git命令自动补全和状态显示", installed: true },
  { name: "Docker工具", description: "Docker容器管理快捷命令", installed: false },
  { name: "Kubernetes", description: "kubectl命令快捷方式", installed: false },
  { name: "AWS CLI", description: "AWS服务快速访问", installed: false },
];

export function PluginsModule() {
  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-medium">插件市场</h3>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-1" />
          安装插件
        </Button>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {plugins.map((plugin, index) => (
          <div key={index} className="p-4 border-b">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <h4 className="font-medium">{plugin.name}</h4>
                  {plugin.installed && (
                    <Star className="h-3 w-3 text-yellow-500 fill-current" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {plugin.description}
                </p>
              </div>
              <Button 
                variant={plugin.installed ? "secondary" : "default"} 
                size="sm"
                className="ml-2"
              >
                {plugin.installed ? "已安装" : "安装"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}