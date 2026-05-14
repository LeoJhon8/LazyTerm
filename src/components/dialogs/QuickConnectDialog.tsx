/**
 * 快速连接弹窗 — 左侧选择连接类型，右侧展示对应配置/启动面板
 * 本地终端：卡片式展示可用 Shell，支持管理员模式一键启动
 * 远程连接：复用 connection-forms 的表单组件，提交按钮为"连接"
 */
import { useState, useEffect, useCallback } from "react";
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
  MonitorCheck,
  ShieldAlert,
  Boxes,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { ConnectionTypeList, type ConnectionTypeOption } from "./ConnectionTypeList";
import { getAvailableShells } from "@/services/shellService";
import { logger } from "@/lib/logger";
import type { ShellInfo } from "@/types/shell";
import {
  SshForm,
  RdpForm,
  VncForm,
  SerialForm,
  TelnetForm,
  AiCliForm,
} from "./connection-forms";

/** 连接类型定义（包含本地终端） */
type QuickConnectType = "local" | "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli";

const CONNECTION_TYPES: Array<ConnectionTypeOption<QuickConnectType>> = [
  { type: "local", icon: <Terminal className="h-4 w-4 text-blue-600/80" />, labelKey: "本地终端" },
  { type: "ssh", icon: <Server className="h-4 w-4 text-emerald-600/80" />, labelKey: "SSH" },
  { type: "ai-cli", icon: <Terminal className="h-4 w-4 text-violet-600/80" />, labelKey: "AI CLI" },
  { type: "rdp", icon: <AppWindow className="h-4 w-4 text-sky-600/80" />, labelKey: "Windows 远程" },
  { type: "vnc", icon: <ScreenShare className="h-4 w-4 text-emerald-600/80" />, labelKey: "VNC" },
  { type: "telnet", icon: <Terminal className="h-4 w-4 text-emerald-500/80" />, labelKey: "Telnet" },
  { type: "serial", icon: <Usb className="h-4 w-4 text-purple-600/80" />, labelKey: "串口" },
];

/** Shell 图标 */
function getShellIcon(type: string) {
  switch (type) {
    case 'powershell': return <MonitorCheck className="h-4 w-4 text-blue-500" />;
    case 'cmd': return <Terminal className="h-4 w-4 text-muted-foreground" />;
    case 'bash': return <Terminal className="h-4 w-4 text-orange-500" />;
    case 'wsl': return <Boxes className="h-4 w-4 text-purple-500" />;
    default: return <Terminal className="h-4 w-4" />;
  }
}

interface QuickConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 初始连接类型（可选） */
  initialType?: QuickConnectType;
  /** 连接回调 */
  onConnect: (sessionData: {
    title: string;
    type: string;
    host?: string;
    config: Record<string, unknown>;
  }) => void;
}

export function QuickConnectDialog({ open, onOpenChange, initialType, onConnect }: QuickConnectDialogProps) {
  const { t } = useI18n();
  const [selectedType, setSelectedType] = useState<QuickConnectType>(initialType || "local");
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);
  const [adminMode, setAdminMode] = useState(false);

  // 加载可用 Shell 列表
  useEffect(() => {
    if (open) {
      getAvailableShells()
        .then(setAvailableShells)
        .catch(err => logger.error("FE/quick-connect", "获取 Shell 列表失败", { err }));
    }
  }, [open]);

  // 弹窗打开时重置
  useEffect(() => {
    if (open) {
      setSelectedType(initialType || "local");
      setAdminMode(false);
    }
  }, [open, initialType]);

  const handleLaunchShell = useCallback((shell: ShellInfo) => {
    onConnect({
      title: adminMode ? t("{name} (管理员)", { name: shell.name }) : shell.name,
      type: "local",
      config: { shell: shell.path, admin: adminMode },
    });
    onOpenChange(false);
  }, [adminMode, onConnect, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-165 p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{t("快速连接")}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[420px]">
          <ConnectionTypeList options={CONNECTION_TYPES} selectedType={selectedType} onSelect={setSelectedType} />

          {/* 右侧：配置面板 */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* 本地终端面板 */}
              {selectedType === "local" && (
                <div className="space-y-4">
                  {/* 管理员模式开关 */}
                  <div className="flex items-center gap-3 pb-2">
                    <Checkbox
                      id="admin-mode"
                      checked={adminMode}
                      onCheckedChange={(checked) => setAdminMode(checked === true)}
                    />
                    <Label htmlFor="admin-mode" className="text-sm flex items-center gap-2">
                      <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                      {t("以管理员身份运行")}
                    </Label>
                  </div>

                  {/* Shell 卡片网格 */}
                  <div className="grid grid-cols-2 gap-2">
                    {availableShells.map((shell, index) => (
                      <button
                        key={`${shell.path}-${index}`}
                        onClick={() => handleLaunchShell(shell)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium",
                          "border border-border/50 bg-background hover:bg-accent/50 hover:border-accent/50",
                          "transition-colors duration-150"
                        )}
                      >
                        {getShellIcon(shell.icon_type)}
                        <span className="truncate">{shell.name}</span>
                      </button>
                    ))}
                  </div>

                  {availableShells.length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-8">
                      {t("未检测到可用的终端")}
                    </div>
                  )}
                </div>
              )}

              {/* 远程连接表单 */}
              {selectedType === "ssh" && <SshForm onSubmit={(cfg) => { onConnect({ title: cfg.nickname || cfg.host, type: "ssh", host: cfg.host, config: { host: cfg.host, port: cfg.port, sshConfig: cfg } }); onOpenChange(false); }} submitLabel="连接" />}
              {selectedType === "rdp" && <RdpForm onSubmit={(cfg) => { onConnect({ title: cfg.nickname || cfg.host, type: "rdp", host: cfg.host, config: { host: cfg.host, port: cfg.port, rdpConfig: cfg } }); onOpenChange(false); }} submitLabel="连接" />}
              {selectedType === "vnc" && <VncForm onSubmit={(cfg) => { onConnect({ title: cfg.nickname || cfg.host, type: "vnc", host: cfg.host, config: { host: cfg.host, port: cfg.port, vncConfig: cfg } }); onOpenChange(false); }} submitLabel="连接" />}
              {selectedType === "serial" && <SerialForm onSubmit={(cfg) => { onConnect({ title: cfg.nickname || cfg.port, type: "serial", host: cfg.port, config: { serialConfig: cfg } }); onOpenChange(false); }} submitLabel="连接" />}
              {selectedType === "telnet" && <TelnetForm onSubmit={(cfg) => { onConnect({ title: cfg.nickname || cfg.host, type: "telnet", host: cfg.host, config: { telnetConfig: cfg } }); onOpenChange(false); }} submitLabel="连接" />}
              {selectedType === "ai-cli" && <AiCliForm onSubmit={(cfg) => { onConnect({ title: cfg.nickname || cfg.command, type: "ai-cli", config: { aiCliConfig: cfg } }); onOpenChange(false); }} submitLabel="连接" />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
