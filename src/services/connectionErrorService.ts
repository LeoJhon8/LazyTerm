import type { SessionCreationData } from "@/connectors/ConnectorFactory";
import { getErrorMessage } from "@/lib/errorUtils";
import { tCurrent } from "@/i18n";

/**
 * 连接错误展示信息
 */
export interface ConnectionErrorPresentation {
  summary: string;
  guidance: string[];
  technicalDetails: string;
}

/**
 * 会话连接错误
 */
export interface SessionConnectionError {
  sessionId: string;
  sessionTitle: string;
  sessionType: SessionCreationData["type"];
  sessionTarget?: string;
  summary: string;
  guidance: string[];
  technicalDetails: string;
}

/**
 * 获取会话的目标地址标签（如 user@host:port）
 */
export function getSessionTargetLabel(sessionData: SessionCreationData): string | undefined {
  if (sessionData.type === "ssh") {
    const sshConfig = sessionData.config?.sshConfig;
    if (sshConfig?.username && sshConfig.host && sshConfig.port) {
      return `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`;
    }

    if (sessionData.host && sessionData.config?.port) {
      return `${sessionData.host}:${sessionData.config.port}`;
    }
  }

  if (sessionData.type === "rdp") {
    const rdpConfig = sessionData.config?.rdpConfig;
    if (rdpConfig?.host && rdpConfig.port) {
      return `${rdpConfig.host}:${rdpConfig.port}`;
    }
  }

  if (sessionData.type === "vnc") {
    const vncConfig = sessionData.config?.vncConfig;
    if (vncConfig?.host && vncConfig.port) {
      return `${vncConfig.host}:${vncConfig.port}`;
    }
  }

  return undefined;
}

/**
 * 根据会话类型和错误对象，生成结构化的错误展示信息
 */
export function getConnectionErrorPresentation(
  sessionType: SessionCreationData["type"],
  error: unknown,
): ConnectionErrorPresentation {
  const technicalDetails = getErrorMessage(error);

  switch (sessionType) {
    case "rdp":
      return buildRdpErrorPresentation(technicalDetails);
    case "vnc":
      return buildVncErrorPresentation(technicalDetails);
    case "ssh":
      return buildSshErrorPresentation(technicalDetails);
    default:
      return buildLocalErrorPresentation(technicalDetails);
  }
}

/**
 * 获取会话创建失败的日志标签
 */
export function getOpenFailureLogLabel(sessionType: SessionCreationData["type"]): string {
  switch (sessionType) {
    case "ssh":
      return tCurrent("[Tauri] SSH 会话创建失败:");
    case "rdp":
      return tCurrent("[Tauri] RDP 会话创建失败:");
    case "vnc":
      return tCurrent("[Tauri] VNC 会话创建失败:");
    case "local":
      return tCurrent("[Tauri] 终端进程创建失败:");
    default:
      return tCurrent("[Tauri] 会话创建失败:");
  }
}

function buildRdpErrorPresentation(technicalDetails: string): ConnectionErrorPresentation {
  const normalized = technicalDetails.toLowerCase();

  if (normalized.includes("仅支持密码认证")) {
    return {
      summary: tCurrent("当前 RDP 连接只支持密码认证。"),
      guidance: [
        tCurrent("请填写密码后重新连接。"),
      ],
      technicalDetails,
    };
  }

  if (normalized.includes("lookup addr failed") || normalized.includes("socket address not found") || normalized.includes("invalid server name")) {
    return {
      summary: tCurrent("目标主机地址无法解析。"),
      guidance: [
        tCurrent("检查主机名或 IP 是否填写正确。"),
        tCurrent("如果使用域名，确认本机 DNS 可以解析该地址。"),
      ],
      technicalDetails,
    };
  }

  if (normalized.includes("tcp connect failed")) {
    if (normalized.includes("10061") || normalized.includes("actively refused")) {
      return {
        summary: tCurrent("目标主机拒绝了远程桌面连接。"),
        guidance: [
          tCurrent("确认目标主机已启用远程桌面服务。"),
          tCurrent("确认端口填写正确，默认通常为 3389。"),
          tCurrent("检查目标主机防火墙是否允许该端口。"),
        ],
        technicalDetails,
      };
    }

    return {
      summary: tCurrent("无法连接到远程桌面主机。"),
      guidance: [
        tCurrent("确认目标主机在线且网络可达。"),
        tCurrent("确认端口填写正确，默认通常为 3389。"),
        tCurrent("检查防火墙、安全组或 NAT 转发是否放通该端口。"),
      ],
      technicalDetails,
    };
  }

  if (normalized.includes("tls handshake") || normalized.includes("begin connection failed")) {
    return {
      summary: tCurrent("目标端口已连接，但 RDP 握手失败。"),
      guidance: [
        tCurrent("确认该端口运行的是 RDP 服务。"),
        tCurrent("确认目标主机已启用远程桌面服务。"),
        tCurrent("若使用代理或端口映射，请确认未阻断 TLS/RDP 协商。"),
      ],
      technicalDetails,
    };
  }

  if (normalized.includes("credssp") || normalized.includes("logon") || normalized.includes("authentication") || normalized.includes("finalize connection failed")) {
    return {
      summary: tCurrent("RDP 认证或会话初始化失败。"),
      guidance: [
        tCurrent("检查用户名、密码和域是否正确。"),
        tCurrent("确认服务器允许该账号使用远程桌面登录。"),
        tCurrent("检查服务器的 NLA 和加密策略。"),
      ],
      technicalDetails,
    };
  }

  return {
    summary: tCurrent("远程桌面连接未能建立。"),
    guidance: [
      tCurrent("先确认地址、端口和账号配置正确。"),
      tCurrent("再检查目标主机远程桌面服务和网络连通性。"),
    ],
    technicalDetails,
  };
}

function buildSshErrorPresentation(technicalDetails: string): ConnectionErrorPresentation {
  return {
    summary: tCurrent("SSH 连接未能建立。"),
    guidance: [
      tCurrent("检查主机、端口和认证信息是否正确。"),
      tCurrent("确认服务器 SSH 服务已启动且网络可达。"),
    ],
    technicalDetails,
  };
}

function buildVncErrorPresentation(technicalDetails: string): ConnectionErrorPresentation {
  const normalized = technicalDetails.toLowerCase();

  if (normalized.includes("authentication") || normalized.includes("password") || normalized.includes("auth")) {
    return {
      summary: tCurrent("VNC 认证未通过。"),
      guidance: [
        tCurrent("检查连接密码是否正确。"),
        tCurrent("确认目标 VNC 服务端允许当前认证方式。"),
      ],
      technicalDetails,
    };
  }

  if (normalized.includes("refused") || normalized.includes("10061")) {
    return {
      summary: tCurrent("目标主机拒绝了 VNC 连接。"),
      guidance: [
        tCurrent("确认目标主机已启动 VNC 服务。"),
        tCurrent("确认端口填写正确，默认通常为 5900。"),
        tCurrent("检查目标主机防火墙是否允许该端口。"),
      ],
      technicalDetails,
    };
  }

  return {
    summary: tCurrent("VNC 连接未能建立。"),
    guidance: [
      tCurrent("检查目标主机、端口和密码是否正确。"),
      tCurrent("确认网络可达，且目标 VNC 服务已启动。"),
    ],
    technicalDetails,
  };
}

function buildLocalErrorPresentation(technicalDetails: string): ConnectionErrorPresentation {
  return {
    summary: tCurrent("本地终端启动失败。"),
    guidance: [
      tCurrent("检查默认 Shell 路径是否存在。"),
      tCurrent("管理员模式下，请确认系统允许权限提升。"),
    ],
    technicalDetails,
  };
}
