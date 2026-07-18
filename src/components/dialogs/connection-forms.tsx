/**
 * 连接配置表单组件 — 供 NewConnectionDialog 和 QuickConnectDialog 共享
 * 包含 SSH、RDP、VNC、Serial、Telnet、AI CLI 六种类型的表单
 */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DialogFooter } from "@/components/ui/dialog";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { ChevronDown, Eye, EyeOff, KeyRound, Settings } from "lucide-react";
import { invokeTauri } from "@/services/tauri";
import { logger } from "@/lib/logger";
import { useI18n } from "@/i18n";
import { useCredentialsStore } from "@/store/credentials";
import { useSettingsStore } from "@/store/settings";
import { useSettingsDialogStore } from "@/store/settings-dialog";
import { resolveRdpBackend } from "@/lib/rdp-backend";
import {
  DEFAULT_RDP_RESOLUTION_VALUE,
  getRdpResolutionPreset,
  RDP_RESOLUTION_PRESETS,
} from "@/lib/rdp-resolution";
import type { Credential, CredentialType } from "@/types/credential";
import type {
  SSHConfig,
  RDPConfig,
  VNCConfig,
  SerialConfig,
  TelnetConfig,
  AiCliConfig,
} from "@/types/terminal";

/** 表单提交按钮的文案 key */
export type SubmitLabel = "立即创建" | "连接";

/* ==================== 通用表单字段布局 ==================== */
export function FormField({
  label,
  required,
  description,
  children,
}: {
  label: string;
  required?: boolean;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-4 items-start gap-4">
      <Label className="text-right text-[13px]">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div className="col-span-3 space-y-1.5">
        {children}
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  const label = visible ? t("隐藏密码") : t("显示密码");

  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete="off"
        className="password-input-native-reveal-hidden pr-10"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((current) => !current)}
        title={label}
        aria-label={label}
      >
        <Icon className="h-4 w-4" />
      </Button>
    </div>
  );
}

function CredentialDropdownInput({
  inputType = "text",
  value,
  selectedCredentialId,
  credentialTypes,
  placeholder,
  onManualChange,
  onCredentialChange,
  trailing,
}: {
  inputType?: "text" | "password";
  value: string;
  selectedCredentialId?: string;
  credentialTypes: CredentialType[];
  placeholder?: string;
  onManualChange: (value: string) => void;
  onCredentialChange: (credential: Credential | null) => void;
  trailing?: React.ReactNode;
}) {
  const credentials = useCredentialsStore((state) => state.credentials);
  const openSettings = useSettingsDialogStore((state) => state.openSettings);
  const filteredCredentials = credentials.filter((credential) => credentialTypes.includes(credential.type));
  const selectedCredential = selectedCredentialId
    ? filteredCredentials.find((credential) => credential.id === selectedCredentialId)
    : undefined;
  const displayPlaceholder = selectedCredential
    ? `使用凭据：${selectedCredential.name}`
    : placeholder;

  const handleInputChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    if (selectedCredentialId) onCredentialChange(null);
    onManualChange(event.target.value);
  };

  const input = inputType === "password"
    ? (
      <PasswordInput
        value={selectedCredential ? "" : value}
        onChange={handleInputChange}
        placeholder={displayPlaceholder}
      />
    )
    : (
      <Input
        value={selectedCredential ? "" : value}
        onChange={handleInputChange}
        placeholder={displayPlaceholder}
        className="flex-1"
      />
    );

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">{input}</div>
      {trailing}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" title="选择凭据" aria-label="选择凭据">
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => onCredentialChange(null)}>
            手动输入
          </DropdownMenuItem>
          {filteredCredentials.length > 0 && <DropdownMenuSeparator />}
          {filteredCredentials.map((credential) => (
            <DropdownMenuItem key={credential.id} onClick={() => onCredentialChange(credential)}>
              <KeyRound className="mr-2 h-4 w-4" />
              <span className="truncate">{credential.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openSettings("credentials")}>
            <Settings className="mr-2 h-4 w-4" />
            管理凭据
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ==================== SSH 表单 ==================== */
export function SshForm({ onSubmit, submitLabel }: { onSubmit: (config: SSHConfig) => void; submitLabel: SubmitLabel }) {
  const { t } = useI18n();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [nickname, setNickname] = useState("");
  const [passwordCredentialId, setPasswordCredentialId] = useState<string | undefined>();
  const [privateKeyCredentialId, setPrivateKeyCredentialId] = useState<string | undefined>();

  const handleSelectKey = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        title: t("选择私钥文件"),
        filters: [{ name: "All Files", extensions: ["*"] }],
      });
      if (selected && typeof selected === "string") {
        setPasswordCredentialId(undefined);
        setPrivateKeyCredentialId(undefined);
        setPassword("");
        setPrivateKeyPath(selected);
      }
    } catch (err) {
      logger.error("FE/dialog/connection-forms/ssh", "选择私钥文件失败", { err });
    }
  };

  const handleSubmit = () => {
    if (!host || !port || !username) return;
    const credentialId = privateKeyCredentialId ?? passwordCredentialId;
    const credential = credentialId ? useCredentialsStore.getState().getCredential(credentialId) : undefined;
    const parsedPort = parseInt(port, 10);
    onSubmit({
      host,
      port: parsedPort,
      username,
      credentialId,
      authType: credential?.type === "ssh-key" || privateKeyPath ? "privateKey" : "password",
      password: credentialId ? undefined : (password || undefined),
      privateKeyPath: credentialId ? undefined : (privateKeyPath || undefined),
      nickname: nickname || undefined,
      keepAlive: parsedPort === 2222 ? undefined : true,
      keepAliveInterval: parsedPort === 2222 ? undefined : 60,
      readyTimeout: 30000,
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="grid gap-4">
      <FormField label={t("名称")} description="留空时使用主机地址">
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </FormField>
      <FormField label={t("主机地址")} required>
        <Input value={host} onChange={(e) => setHost(e.target.value)} required />
      </FormField>
      <FormField label={t("端口")} required>
        <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} required />
      </FormField>
      <FormField label={t("用户名")} required>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
      </FormField>
      <Separator />
      <FormField label={t("密码")}>
        <CredentialDropdownInput
          inputType="password"
          value={password}
          selectedCredentialId={passwordCredentialId}
          credentialTypes={["password"]}
          onManualChange={(nextPassword) => {
            setPassword(nextPassword);
            setPasswordCredentialId(undefined);
            setPrivateKeyCredentialId(undefined);
            setPrivateKeyPath("");
          }}
          onCredentialChange={(credential) => {
            setPasswordCredentialId(credential?.id);
            setPrivateKeyCredentialId(undefined);
            setPassword("");
            setPrivateKeyPath("");
            if (credential?.username) setUsername(credential.username);
          }}
        />
      </FormField>
      <FormField label={t("私钥路径")}>
        <CredentialDropdownInput
          value={privateKeyPath}
          selectedCredentialId={privateKeyCredentialId}
          credentialTypes={["ssh-key"]}
          onManualChange={(nextPrivateKeyPath) => {
            setPrivateKeyPath(nextPrivateKeyPath);
            setPrivateKeyCredentialId(undefined);
            setPasswordCredentialId(undefined);
            setPassword("");
          }}
          onCredentialChange={(credential) => {
            setPrivateKeyCredentialId(credential?.id);
            setPasswordCredentialId(undefined);
            setPassword("");
            setPrivateKeyPath(credential?.privateKeyPath ?? "");
            if (credential?.username) setUsername(credential.username);
          }}
          trailing={<Button type="button" variant="outline" size="sm" onClick={handleSelectKey}>{t("浏览")}</Button>}
        />
      </FormField>
      <DialogFooter className="pt-2">
        <Button type="submit" disabled={!host || !port || !username}>{t(submitLabel)}</Button>
      </DialogFooter>
    </form>
  );
}

/* ==================== RDP 表单 ==================== */
export function RdpForm({ onSubmit, submitLabel }: { onSubmit: (config: RDPConfig) => void; submitLabel: SubmitLabel }) {
  const { t } = useI18n();
  const configuredRdpBackend = useSettingsStore((state) => state.rdpBackend);
  const fixedBackend = resolveRdpBackend(configuredRdpBackend);
  const usesNativeRdp = fixedBackend === "msrdpax";

  const [host, setHost] = useState("");
  const [port, setPort] = useState("3389");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [nickname, setNickname] = useState("");
  const [credentialId, setCredentialId] = useState<string | undefined>();
  const [resolution, setResolution] = useState(DEFAULT_RDP_RESOLUTION_VALUE);

  const handleSubmit = () => {
    if (!host || !username) return;
    const selectedResolution = getRdpResolutionPreset(resolution);
    onSubmit({
      host,
      port: parseInt(port, 10) || 3389,
      username,
      credentialId,
      password: credentialId ? undefined : (password || undefined),
      domain: domain || undefined,
      nickname: nickname || undefined,
      width: usesNativeRdp ? undefined : selectedResolution.width,
      height: usesNativeRdp ? undefined : selectedResolution.height,
      autoResize: usesNativeRdp ? true : false,
      backend: fixedBackend,
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="grid gap-4">
      <FormField label={t("名称")} description="留空时使用主机地址">
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </FormField>
      <FormField label={t("主机地址")} required>
        <Input value={host} onChange={(e) => setHost(e.target.value)} required />
      </FormField>
      <FormField label={t("端口")} required>
        <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} required />
      </FormField>
      <FormField label={t("用户名")} required>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
      </FormField>
      <FormField label={t("域")}>
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} />
      </FormField>
      <FormField label={t("密码")}>
        <CredentialDropdownInput
          inputType="password"
          value={password}
          selectedCredentialId={credentialId}
          credentialTypes={["password"]}
          onManualChange={(nextPassword) => {
            setCredentialId(undefined);
            setPassword(nextPassword);
          }}
          onCredentialChange={(credential) => {
            setCredentialId(credential?.id);
            if (credential) setPassword("");
            if (credential?.username) setUsername(credential.username);
          }}
        />
      </FormField>
      {!usesNativeRdp && (
        <>
          <Separator />
          <FormField label={t("桌面分辨率")}>
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RDP_RESOLUTION_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.width} × {preset.height}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </>
      )}
      <DialogFooter className="pt-2">
        <Button type="submit" disabled={!host || !username}>{t(submitLabel)}</Button>
      </DialogFooter>
    </form>
  );
}

/* ==================== VNC 表单 ==================== */
export function VncForm({ onSubmit, submitLabel }: { onSubmit: (config: VNCConfig) => void; submitLabel: SubmitLabel }) {
  const { t } = useI18n();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5900");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [quality, setQuality] = useState(30);
  const [viewOnly, setViewOnly] = useState(false);
  const [credentialId, setCredentialId] = useState<string | undefined>();

  const handleSubmit = () => {
    if (!host) return;
    onSubmit({
      host,
      port: parseInt(port, 10) || 5900,
      credentialId,
      password: credentialId ? undefined : (password || undefined),
      nickname: nickname || undefined,
      shared: true,
      viewOnly,
      allowJpeg: true,
      quality,
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="grid gap-4">
      <FormField label={t("名称")} description="留空时使用主机地址">
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </FormField>
      <FormField label={t("主机地址")} required>
        <Input value={host} onChange={(e) => setHost(e.target.value)} required />
      </FormField>
      <FormField label={t("端口")} required>
        <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} required />
      </FormField>
      <FormField label={t("密码")} description="无密码时留空">
        <CredentialDropdownInput
          inputType="password"
          value={password}
          selectedCredentialId={credentialId}
          credentialTypes={["password"]}
          onManualChange={(nextPassword) => {
            setCredentialId(undefined);
            setPassword(nextPassword);
          }}
          onCredentialChange={(credential) => {
            setCredentialId(credential?.id);
            if (credential) setPassword("");
          }}
        />
      </FormField>
      <Separator />
      <FormField label={t("渲染质量")}>
        <div className="flex items-center gap-4">
          <Slider min={10} max={100} step={10} value={[quality]} onValueChange={(val) => setQuality(val[0])} className="flex-1" />
          <span className="text-sm w-8 text-right">{quality}%</span>
        </div>
      </FormField>
      <FormField label={t("仅查看")} description={t("连接后不发送鼠标与键盘输入")}>
        <div className="flex items-center gap-3">
          <Checkbox
            id="vnc-view-only-qc"
            checked={viewOnly}
            onCheckedChange={(checked) => setViewOnly(checked === true)}
          />
          <Label htmlFor="vnc-view-only-qc" className="text-sm text-muted-foreground">
            {t("启用只读模式")}
          </Label>
        </div>
      </FormField>
      <DialogFooter className="pt-2">
        <Button type="submit" disabled={!host}>{t(submitLabel)}</Button>
      </DialogFooter>
    </form>
  );
}

/* ==================== Serial 表单 ==================== */
const DEFAULT_SERIAL_CONFIG: SerialConfig = {
  port: "",
  baudRate: 115200,
  dataBits: 8,
  parity: "None",
  stopBits: 1,
  flowControl: "None",
  nickname: "",
};

export function SerialForm({ onSubmit, submitLabel }: { onSubmit: (config: SerialConfig) => void; submitLabel: SubmitLabel }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<SerialConfig>(DEFAULT_SERIAL_CONFIG);
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);

  useEffect(() => {
    loadPorts();
  }, []);

  const loadPorts = async () => {
    setLoadingPorts(true);
    try {
      const ports = await invokeTauri<string[]>("list_serial_ports", {}, { scope: "FE/dialog/connection-forms/serial" });
      setAvailablePorts(ports || []);
      if (!config.port && ports && ports.length > 0) {
        setConfig(c => ({ ...c, port: ports[0] }));
      }
    } catch (e) {
      logger.error("FE/dialog/connection-forms/serial", "获取串口列表失败", e);
    } finally {
      setLoadingPorts(false);
    }
  };

  const handleSubmit = () => {
    if (!config.port) return;
    onSubmit({ ...config, nickname: config.nickname || config.port });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="grid gap-4">
      <FormField label={t("名称")} description="留空时使用串口名称">
        <Input value={config.nickname || ""} onChange={(e) => setConfig({ ...config, nickname: e.target.value })} />
      </FormField>
      <FormField label={t("端口")} required>
        <div className="flex gap-2">
          <Input
            list="serial-ports-list-qc"
            value={config.port}
            onChange={(e) => setConfig({ ...config, port: e.target.value })}
            placeholder={loadingPorts ? t("加载中...") : t("选择或输入串口")}
          />
          <datalist id="serial-ports-list-qc">
            {availablePorts.map((p) => <option key={p} value={p} />)}
            {config.port && !availablePorts.includes(config.port) && <option value={config.port} />}
          </datalist>
          <Button type="button" variant="outline" size="icon" onClick={(e) => { e.preventDefault(); e.stopPropagation(); loadPorts(); }} title={t("刷新端口列表")} className="shrink-0 h-9 w-9">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>
          </Button>
        </div>
      </FormField>
      <FormField label={t("波特率")}>
        <Select value={config.baudRate.toString()} onValueChange={(val) => setConfig({ ...config, baudRate: parseInt(val, 10) })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map(r => (
              <SelectItem key={r} value={r.toString()}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label={t("数据位")}>
        <Select value={config.dataBits.toString()} onValueChange={(val) => setConfig({ ...config, dataBits: parseInt(val, 10) })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {[5, 6, 7, 8].map(r => <SelectItem key={r} value={r.toString()}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label={t("停止位")}>
        <Select value={config.stopBits.toString()} onValueChange={(val) => setConfig({ ...config, stopBits: parseInt(val, 10) })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {[1, 2].map(r => <SelectItem key={r} value={r.toString()}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label={t("校验位")}>
        <Select value={config.parity} onValueChange={(val: any) => setConfig({ ...config, parity: val })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="None">None</SelectItem>
            <SelectItem value="Odd">Odd</SelectItem>
            <SelectItem value="Even">Even</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField label={t("流控")}>
        <Select value={config.flowControl} onValueChange={(val: any) => setConfig({ ...config, flowControl: val })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="None">None</SelectItem>
            <SelectItem value="Software">Software(XON/XOFF)</SelectItem>
            <SelectItem value="Hardware">Hardware(RTS/CTS)</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <DialogFooter className="pt-2">
        <Button type="submit" disabled={!config.port}>{t(submitLabel)}</Button>
      </DialogFooter>
    </form>
  );
}

/* ==================== Telnet 表单 ==================== */
export function TelnetForm({ onSubmit, submitLabel }: { onSubmit: (config: TelnetConfig) => void; submitLabel: SubmitLabel }) {
  const { t } = useI18n();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("23");
  const [nickname, setNickname] = useState("");

  const handleSubmit = () => {
    if (!host) return;
    onSubmit({
      host,
      port: parseInt(port, 10) || 23,
      nickname: nickname || undefined,
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="grid gap-4">
      <FormField label={t("名称")} description="留空时使用主机名">
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </FormField>
      <FormField label={t("主机名 (Host)")} required>
        <Input value={host} onChange={(e) => setHost(e.target.value)} required />
      </FormField>
      <FormField label={t("端口 (Port)")} required>
        <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} required />
      </FormField>
      <DialogFooter className="pt-2">
        <Button type="submit" disabled={!host}>{t(submitLabel)}</Button>
      </DialogFooter>
    </form>
  );
}

/* ==================== AI CLI 表单 ==================== */
export function AiCliForm({ onSubmit, submitLabel }: { onSubmit: (config: AiCliConfig) => void; submitLabel: SubmitLabel }) {
  const { t } = useI18n();
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [nickname, setNickname] = useState("");

  const handleSelectCwd = async () => {
    try {
      const selected = await openFileDialog({
        directory: true,
        multiple: false,
        title: t("选择工作目录"),
      });
      if (selected && typeof selected === "string") {
        setCwd(selected);
      }
    } catch (error) {
      logger.error("FE/dialog/connection-forms/ai-cli", "选择目录失败", error);
    }
  };

  const handleSubmit = () => {
    if (!command.trim()) return;
    const config: AiCliConfig = {
      command: command.trim(),
      nickname: nickname.trim() || undefined,
    };
    if (args.trim()) {
      config.args = args.split(",").map(arg => arg.trim()).filter(Boolean);
    }
    if (cwd.trim()) {
      config.cwd = cwd.trim();
    }
    onSubmit(config);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="grid gap-4">
      <FormField label={t("名称")} description="留空时使用命令名">
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </FormField>
      <FormField label={t("命令")} required>
        <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t("请输入命令")} required />
      </FormField>
      <FormField label={t("参数")} description="多个参数用逗号分隔">
        <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder={t("请输入参数")} />
      </FormField>
      <FormField label={t("工作目录")} description="留空时使用当前目录">
        <div className="flex gap-2">
          <Input value={cwd} onChange={(e) => setCwd(e.target.value)} className="flex-1" />
          <Button type="button" variant="outline" size="sm" onClick={handleSelectCwd}>{t("浏览")}</Button>
        </div>
      </FormField>
      <DialogFooter className="pt-2">
        <Button type="submit" disabled={!command.trim()}>{t(submitLabel)}</Button>
      </DialogFooter>
    </form>
  );
}
