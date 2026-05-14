import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Server,
  AppWindow,
  ScreenShare,
  Usb,
  Terminal,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { ConnectionTypeList, type ConnectionTypeOption } from "./ConnectionTypeList";
import type {
  SSHConfig,
  RDPConfig,
  VNCConfig,
  SerialConfig,
  TelnetConfig,
  AiCliConfig,
} from "@/types/terminal";
import {
  SshForm,
  RdpForm,
  VncForm,
  SerialForm,
  TelnetForm,
  AiCliForm,
} from "./connection-forms";

/** 连接类型定义 */
type ConnectionType = "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli";

const CONNECTION_TYPES: Array<ConnectionTypeOption<ConnectionType>> = [
  { type: "ssh", icon: <Server className="h-4 w-4 text-emerald-600/80" />, labelKey: "SSH" },
  { type: "ai-cli", icon: <Terminal className="h-4 w-4 text-violet-600/80" />, labelKey: "AI CLI" },
  { type: "rdp", icon: <AppWindow className="h-4 w-4 text-sky-600/80" />, labelKey: "Windows 远程" },
  { type: "vnc", icon: <ScreenShare className="h-4 w-4 text-emerald-600/80" />, labelKey: "VNC" },
  { type: "telnet", icon: <Terminal className="h-4 w-4 text-emerald-500/80" />, labelKey: "Telnet" },
  { type: "serial", icon: <Usb className="h-4 w-4 text-purple-600/80" />, labelKey: "串口" },
];

interface NewConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 初始连接类型（可选，默认 ssh） */
  initialType?: ConnectionType;
  /** 保存回调，返回类型和配置 */
  onSave: (type: ConnectionType, config: SSHConfig | RDPConfig | VNCConfig | SerialConfig | TelnetConfig | AiCliConfig) => void;
}

export function NewConnectionDialog({ open, onOpenChange, initialType, onSave }: NewConnectionDialogProps) {
  const { t } = useI18n();
  const [selectedType, setSelectedType] = useState<ConnectionType>(initialType || "ssh");

  // 弹窗打开时重置
  useEffect(() => {
    if (open) {
      setSelectedType(initialType || "ssh");
    }
  }, [open, initialType]);

  const handleSave = (config: SSHConfig | RDPConfig | VNCConfig | SerialConfig | TelnetConfig | AiCliConfig) => {
    onSave(selectedType, config);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-165 p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{t("新建连接")}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[420px]">
          <ConnectionTypeList options={CONNECTION_TYPES} selectedType={selectedType} onSelect={setSelectedType} />

          {/* 右侧：配置表单 */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {selectedType === "ssh" && <SshForm onSubmit={handleSave} submitLabel="立即创建" />}
              {selectedType === "rdp" && <RdpForm onSubmit={handleSave} submitLabel="立即创建" />}
              {selectedType === "vnc" && <VncForm onSubmit={handleSave} submitLabel="立即创建" />}
              {selectedType === "serial" && <SerialForm onSubmit={handleSave} submitLabel="立即创建" />}
              {selectedType === "telnet" && <TelnetForm onSubmit={handleSave} submitLabel="立即创建" />}
              {selectedType === "ai-cli" && <AiCliForm onSubmit={handleSave} submitLabel="立即创建" />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
