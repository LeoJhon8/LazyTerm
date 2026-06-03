import type {
  RDPConfig,
  SessionConnector,
  SSHConfig,
  VNCConfig,
  SerialConfig,
  TelnetConfig,
  AiCliConfig,
} from "@/types/terminal";
import { useSettingsStore } from "@/store/settings";
import { LocalConnector } from "@/connectors/LocalConnector";
import { SshConnector, type PtyFontConfig } from "@/connectors/SshConnector";
import { RdpConnector } from "@/connectors/RdpConnector";
import { NativeRdpConnector } from "@/connectors/NativeRdpConnector";
import { VncConnector } from "@/connectors/VncConnector";
import { SerialConnector } from "@/connectors/SerialConnector";
import { TelnetConnector } from "@/connectors/TelnetConnector";
import { AiCliConnector } from "@/connectors/AiCliConnector";
import { resolveRdpBackend } from "@/lib/rdp-backend";
import { resolveRdpCredential, resolveSshCredential, resolveVncCredential } from "@/store/credentials";

export interface SessionCreationData {
  type: "local" | "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli";
  cwd?: string;
  title?: string;
  host?: string;
  config?: {
    cwd?: string;
    shell?: string;
    host?: string;
    port?: number;
    sshConfig?: SSHConfig;
    rdpConfig?: RDPConfig;
    vncConfig?: VNCConfig;
    serialConfig?: SerialConfig;
    telnetConfig?: TelnetConfig;
    aiCliConfig?: AiCliConfig;
    admin?: boolean;
  };
}

/**
 * 获取当前字体配置
 * 从 SettingsStore 读取，用于 SSH 连接器初始化 PTY 大小
 */
function getCurrentFontConfig(): PtyFontConfig {
  const { fontFamily, fontSize } = useSettingsStore.getState();
  return { fontFamily, fontSize };
}

/**
 * 根据会话数据创建对应的连接器实例
 */
export function createConnector(
  sessionData: SessionCreationData,
  sessionId: string,
  onDisconnect?: (sessionId: string) => void,
): SessionConnector {
  switch (sessionData.type) {
    case "local":
      return new LocalConnector({
        cwd: sessionData.cwd,
        shell: sessionData.config?.shell,
        admin: sessionData.config?.admin,
      }, () => {
        if (onDisconnect) {
          onDisconnect(sessionId);
        }
      });
    case "ssh":
      if (!sessionData.config?.sshConfig) {
        throw new Error("SSH 配置不能为空");
      }

      {
        const config = resolveSshCredential(sessionData.config.sshConfig);
        return new SshConnector({
          config,
          fontConfig: getCurrentFontConfig(),
          onDisconnect: () => {
            if (onDisconnect) {
              onDisconnect(sessionId);
            }
          },
        });
      }
    case "rdp":
      if (!sessionData.config?.rdpConfig) {
        throw new Error("RDP 配置不能为空");
      }

      {
        const config = resolveRdpCredential(sessionData.config.rdpConfig);
        const backend = resolveRdpBackend(useSettingsStore.getState().rdpBackend);
        const normalizedConfig = {
          ...config,
          backend,
          autoResize: backend === "msrdpax" ? true : false,
        };
        return backend === "msrdpax"
          ? new NativeRdpConnector(normalizedConfig)
          : new RdpConnector(normalizedConfig);
      }
    case "vnc":
      if (!sessionData.config?.vncConfig) {
        throw new Error("VNC 配置不能为空");
      }

      return new VncConnector(resolveVncCredential(sessionData.config.vncConfig));
    case "serial":
      if (!sessionData.config?.serialConfig) {
        throw new Error("Serial 配置不能为空");
      }
      return new SerialConnector(
        sessionData.config.serialConfig,
        () => {
          if (onDisconnect) {
            onDisconnect(sessionId);
          }
        }
      );
    case "telnet":
      if (!sessionData.config?.telnetConfig) {
        throw new Error("Telnet 配置不能为空");
      }
      return new TelnetConnector(
        sessionData.config.telnetConfig,
        () => {
          if (onDisconnect) {
            onDisconnect(sessionId);
          }
        }
      );
    case "ai-cli":
      if (!sessionData.config?.aiCliConfig) {
        throw new Error("AI CLI 配置不能为空");
      }
      return new AiCliConnector(
        sessionData.config.aiCliConfig,
        () => {
          if (onDisconnect) {
            onDisconnect(sessionId);
          }
        },
        sessionId
      );
    default:
      throw new Error(`不支持的连接类型：${sessionData.type}`);
  }
}
