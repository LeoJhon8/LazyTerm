import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/dialogs/connection-forms";
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
import { useI18n } from "@/i18n";

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
  const { t } = useI18n();
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
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>{isDirect ? t("串口连接") : initialConfig ? t("编辑串口配置") : t("新建串口连接")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <FormField label={t("名称")} htmlFor="serial-nickname">
            <Input
              id="serial-nickname"
              value={config.nickname || ""}
              onChange={(e) => setConfig({ ...config, nickname: e.target.value })}
            />
          </FormField>

          <FormField label={t("端口")} htmlFor="serial-port" required>
            <div className="flex gap-2">
              <Input
                id="serial-port"
                list="serial-ports-list"
                value={config.port}
                onChange={(e) => setConfig({...config, port: e.target.value})}
                placeholder={loadingPorts ? t("加载中...") : t("选择或输入串口")}
              />
              <datalist id="serial-ports-list">
                {availablePorts.map((p) => (
                  <option key={p} value={p} />
                ))}
                {config.port && !availablePorts.includes(config.port) && (
                  <option value={config.port} />
                )}
              </datalist>
              <Button type="button" variant="outline" size="icon" onClick={(e) => { e.preventDefault(); e.stopPropagation(); loadPorts(); }} title={t("刷新端口列表")} className="h-10 w-10 shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-rotate-cw cursor-pointer"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
              </Button>
            </div>
          </FormField>

          <FormField label={t("波特率")} htmlFor="serial-baud-rate">
            <Select
              value={config.baudRate.toString()}
              onValueChange={(val) => setConfig({...config, baudRate: parseInt(val, 10)})}
            >
              <SelectTrigger id="serial-baud-rate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map(r => (
                  <SelectItem key={r} value={r.toString()}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label={t("数据位")} htmlFor="serial-data-bits">
            <Select
              value={config.dataBits.toString()}
              onValueChange={(val) => setConfig({...config, dataBits: parseInt(val, 10)})}
            >
              <SelectTrigger id="serial-data-bits">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 6, 7, 8].map(r => (
                  <SelectItem key={r} value={r.toString()}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          
          <FormField label={t("停止位")} htmlFor="serial-stop-bits">
            <Select
              value={config.stopBits.toString()}
              onValueChange={(val) => setConfig({...config, stopBits: parseInt(val, 10)})}
            >
              <SelectTrigger id="serial-stop-bits">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2].map(r => (
                  <SelectItem key={r} value={r.toString()}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label={t("校验位")} htmlFor="serial-parity">
            <Select
              value={config.parity}
              onValueChange={(val: any) => setConfig({...config, parity: val})}
            >
              <SelectTrigger id="serial-parity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="None">None</SelectItem>
                <SelectItem value="Odd">Odd</SelectItem>
                <SelectItem value="Even">Even</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          
          <FormField label={t("流控")} htmlFor="serial-flow-control">
            <Select
              value={config.flowControl}
              onValueChange={(val: any) => setConfig({...config, flowControl: val})}
            >
              <SelectTrigger id="serial-flow-control">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="None">None</SelectItem>
                <SelectItem value="Software">Software(XON/XOFF)</SelectItem>
                <SelectItem value="Hardware">Hardware(RTS/CTS)</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

        </div>
        <DialogFooter className="border-t border-border/50 pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("取消")}
          </Button>
          <Button onClick={handleSave} disabled={!config.port}>
            {isDirect ? t("连接") : t("保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
