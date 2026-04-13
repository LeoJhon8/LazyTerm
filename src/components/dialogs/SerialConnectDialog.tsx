import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SerialConfig } from "@/types/terminal";
import { invokeTauri } from "@/services/tauri";
import { logger } from "@/lib/logger";

interface SerialConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (config: SerialConfig) => void;
  initialConfig?: SerialConfig;
  isDirect?: boolean;
}

const DEFAULT_CONFIG: SerialConfig = {
  port: "",
  baudRate: 115200,
  dataBits: 8,
  parity: "None",
  stopBits: 1,
  flowControl: "None",
  nickname: "",
};

export function SerialConnectDialog({
  open,
  onOpenChange,
  onSave,
  initialConfig,
  isDirect,
}: SerialConnectDialogProps) {
  const [config, setConfig] = useState<SerialConfig>(initialConfig || DEFAULT_CONFIG);
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialConfig) {
        setConfig(initialConfig);
      } else {
        setConfig(DEFAULT_CONFIG);
      }
      loadPorts();
    }
  }, [open, initialConfig]);

  const loadPorts = async () => {
    setLoadingPorts(true);
    try {
      const ports = await invokeTauri<string[]>("list_serial_ports", {}, { scope: "FE/dialog/serial" });
      setAvailablePorts(ports || []);
      if (!config.port && ports && ports.length > 0) {
        setConfig(c => ({...c, port: ports[0]}));
      }
    } catch (e) {
      logger.error("FE/dialog/serial", "Failed to list serial ports", e);
    } finally {
      setLoadingPorts(false);
    }
  };

  const handleSave = () => {
    if (!config.port) {
      // Basic validation
      return;
    }
    onSave?.({
      ...config,
      nickname: config.nickname || config.port,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isDirect ? "串口连接" : initialConfig ? "编辑串口配置" : "新建串口连接"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="nickname" className="text-right text-[13px]">
              名称
            </Label>
            <Input
              id="nickname"
              value={config.nickname || ""}
              onChange={(e) => setConfig({ ...config, nickname: e.target.value })}
              className="col-span-3 text-[13px]"
              placeholder="可选的备注名称"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="port" className="text-right text-[13px]">
              端口
            </Label>
            <div className="col-span-3 flex gap-2">
                <Input
                  id="port-input"
                  list="serial-ports-list"
                  value={config.port}
                  onChange={(e) => setConfig({...config, port: e.target.value})}
                  className="w-full text-[13px]"
                  placeholder={loadingPorts ? "加载中..." : "选择或输入串口 (例: COM10)"}
                />
                <datalist id="serial-ports-list">
                  {availablePorts.map((p) => (
                    <option key={p} value={p} />
                  ))}
                  {config.port && !availablePorts.includes(config.port) && (
                    <option value={config.port} />
                  )}
                </datalist>
                <Button type="button" variant="outline" size="icon" onClick={(e) => { e.preventDefault(); e.stopPropagation(); loadPorts(); }} title="刷新端口列表" className="shrink-0 h-9 w-9">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-rotate-cw cursor-pointer"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                </Button>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
             <Label htmlFor="baudRate" className="text-right text-[13px]">
               波特率
             </Label>
             <Select
                value={config.baudRate.toString()}
                onValueChange={(val) => setConfig({...config, baudRate: parseInt(val, 10)})}
              >
                <SelectTrigger className="col-span-3 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map(r => (
                    <SelectItem key={r} value={r.toString()} className="text-[13px]">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
             <Label htmlFor="dataBits" className="text-right text-[13px]">
               数据位
             </Label>
             <Select
                value={config.dataBits.toString()}
                onValueChange={(val) => setConfig({...config, dataBits: parseInt(val, 10)})}
              >
                <SelectTrigger className="col-span-3 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 6, 7, 8].map(r => (
                    <SelectItem key={r} value={r.toString()} className="text-[13px]">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
             <Label htmlFor="stopBits" className="text-right text-[13px]">
               停止位
             </Label>
             <Select
                value={config.stopBits.toString()}
                onValueChange={(val) => setConfig({...config, stopBits: parseInt(val, 10)})}
              >
                <SelectTrigger className="col-span-3 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2].map(r => (
                    <SelectItem key={r} value={r.toString()} className="text-[13px]">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
             <Label htmlFor="parity" className="text-right text-[13px]">
               校验位
             </Label>
             <Select
                value={config.parity}
                onValueChange={(val: any) => setConfig({...config, parity: val})}
              >
                <SelectTrigger className="col-span-3 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="None" className="text-[13px]">None</SelectItem>
                  <SelectItem value="Odd" className="text-[13px]">Odd</SelectItem>
                  <SelectItem value="Even" className="text-[13px]">Even</SelectItem>
                </SelectContent>
              </Select>
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
             <Label htmlFor="flowControl" className="text-right text-[13px]">
               流控
             </Label>
             <Select
                value={config.flowControl}
                onValueChange={(val: any) => setConfig({...config, flowControl: val})}
              >
                <SelectTrigger className="col-span-3 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="None" className="text-[13px]">None</SelectItem>
                  <SelectItem value="Software" className="text-[13px]">Software(XON/XOFF)</SelectItem>
                  <SelectItem value="Hardware" className="text-[13px]">Hardware(RTS/CTS)</SelectItem>
                </SelectContent>
              </Select>
          </div>

        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!config.port}>
            {isDirect ? "连接" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
