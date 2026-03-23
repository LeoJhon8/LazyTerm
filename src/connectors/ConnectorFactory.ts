import type {
  RDPConfig,
  SessionConnector,
  SSHConfig,
  VNCConfig,
} from "@/types/terminal";
import { useSettingsStore } from "@/store/settings";
import { LocalConnector } from "@/connectors/LocalConnector";
import { SshConnector, type PtyFontConfig } from "@/connectors/SshConnector";
import { RdpConnector } from "@/connectors/RdpConnector";
import { NativeRdpConnector } from "@/connectors/NativeRdpConnector";
import { VncConnector } from "@/connectors/VncConnector";

export interface SessionCreationData {
  type: "local" | "ssh" | "rdp" | "vnc";
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

      return new SshConnector({
        config: sessionData.config.sshConfig,
        fontConfig: getCurrentFontConfig(),
        onDisconnect: () => {
          if (onDisconnect) {
            onDisconnect(sessionId);
          }
        },
      });
    case "rdp":
      if (!sessionData.config?.rdpConfig) {
        throw new Error("RDP 配置不能为空");
      }

      return sessionData.config.rdpConfig.backend === "msrdpax"
        ? new NativeRdpConnector(sessionData.config.rdpConfig)
        : new RdpConnector(sessionData.config.rdpConfig);
    case "vnc":
      if (!sessionData.config?.vncConfig) {
        throw new Error("VNC 配置不能为空");
      }

      return new VncConnector(sessionData.config.vncConfig);
    default:
      throw new Error(`不支持的连接类型：${sessionData.type}`);
  }
}
