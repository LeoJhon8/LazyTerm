import type { SessionCreationData } from "@/connectors/ConnectorFactory";
import { tCurrent } from "@/i18n";
import type { ConnectionFailure, ConnectionStage } from "@/types/terminal";
import { classifyConnectionFailure, isConnectionFailure } from "@/services/connection/connectionErrors";

/**
 * 连接错误展示信息
 */
export interface ConnectionErrorPresentation {
  summary: string;
  guidance: string[];
  technicalDetails: string;
  failure: ConnectionFailure;
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
  failure: ConnectionFailure;
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

  if (sessionData.type === "telnet") {
    const telnetConfig = sessionData.config?.telnetConfig;
    if (telnetConfig?.host && telnetConfig.port) {
      return `${telnetConfig.host}:${telnetConfig.port}`;
    }
  }

  if (sessionData.type === "serial") {
    return sessionData.config?.serialConfig?.port;
  }

  return undefined;
}

/**
 * 根据会话类型和错误对象，生成结构化的错误展示信息
 */
export function getConnectionErrorPresentation(
  sessionType: SessionCreationData["type"],
  error: unknown,
  stage: ConnectionStage = "transport",
): ConnectionErrorPresentation {
  const failure = isConnectionFailure(error)
    ? error
    : classifyConnectionFailure(sessionType, error, { stage });

  switch (sessionType) {
    case "rdp":
      return buildRdpErrorPresentation(failure);
    case "vnc":
      return buildVncErrorPresentation(failure);
    case "ssh":
      return buildSshErrorPresentation(failure);
    case "telnet":
      return buildTelnetErrorPresentation(failure);
    case "serial":
      return buildSerialErrorPresentation(failure);
    default:
      return buildLocalErrorPresentation(failure);
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

function buildRdpErrorPresentation(failure: ConnectionFailure): ConnectionErrorPresentation {
  const { technicalDetails } = failure;

  if (failure.code === "CONFIG_INVALID" && technicalDetails.includes("仅支持密码认证")) {
    return {
      summary: tCurrent("当前 RDP 连接只支持密码认证。"),
      guidance: [
        tCurrent("请填写密码后重新连接。"),
      ],
      technicalDetails,
      failure,
    };
  }

  if (failure.code === "DNS_NOT_FOUND") {
    return {
      summary: tCurrent("目标主机地址无法解析。"),
      guidance: [
        tCurrent("检查主机名或 IP 是否填写正确。"),
        tCurrent("如果使用域名，确认本机 DNS 可以解析该地址。"),
      ],
      technicalDetails,
      failure,
    };
  }

  if (failure.code === "CONNECT_REFUSED") {
      return {
        summary: tCurrent("目标主机拒绝了远程桌面连接。"),
        guidance: [
          tCurrent("确认目标主机已启用远程桌面服务。"),
          tCurrent("确认端口填写正确，默认通常为 3389。"),
          tCurrent("检查目标主机防火墙是否允许该端口。"),
        ],
        technicalDetails,
        failure,
      };
  }

  if (failure.code === "CONNECT_TIMEOUT" || failure.code === "IO_TIMEOUT") {
    return {
      summary: tCurrent("无法连接到远程桌面主机。"),
      guidance: [
        tCurrent("确认目标主机在线且网络可达。"),
        tCurrent("确认端口填写正确，默认通常为 3389。"),
        tCurrent("检查防火墙、安全组或 NAT 转发是否放通该端口。"),
      ],
      technicalDetails,
      failure,
    };
  }

  if (failure.code === "PROTOCOL_NEGOTIATION_FAILED") {
    return {
      summary: tCurrent("目标端口已连接，但 RDP 握手失败。"),
      guidance: [
        tCurrent("确认该端口运行的是 RDP 服务。"),
        tCurrent("确认目标主机已启用远程桌面服务。"),
        tCurrent("若使用代理或端口映射，请确认未阻断 TLS/RDP 协商。"),
      ],
      technicalDetails,
      failure,
    };
  }

  if (failure.code === "AUTH_REJECTED") {
    return {
      summary: tCurrent("RDP 认证或会话初始化失败。"),
      guidance: [
        tCurrent("检查用户名、密码和域是否正确。"),
        tCurrent("确认服务器允许该账号使用远程桌面登录。"),
        tCurrent("检查服务器的 NLA 和加密策略。"),
      ],
      technicalDetails,
      failure,
    };
  }

  return {
    summary: tCurrent("远程桌面连接未能建立。"),
    guidance: [
      tCurrent("先确认地址、端口和账号配置正确。"),
      tCurrent("再检查目标主机远程桌面服务和网络连通性。"),
    ],
    technicalDetails,
    failure,
  };
}

function buildSshErrorPresentation(failure: ConnectionFailure): ConnectionErrorPresentation {
  if (failure.code === "HOST_KEY_CHANGED") {
    return {
      summary: tCurrent("SSH 主机身份校验失败。"),
      guidance: [
        tCurrent("服务器主机密钥发生变化，请先核实后再处理 known_hosts 记录。"),
        tCurrent("不要在未确认服务器身份时直接接受新密钥。"),
      ],
      technicalDetails: failure.technicalDetails,
      failure,
    };
  }

  if (failure.code === "AUTH_REJECTED") {
    return {
      summary: tCurrent("SSH 认证未通过。"),
      guidance: [
        tCurrent("检查主机、端口和认证信息是否正确。"),
        tCurrent("确认服务器 SSH 服务已启动且网络可达。"),
      ],
      technicalDetails: failure.technicalDetails,
      failure,
    };
  }

  return {
    summary: tCurrent("SSH 连接未能建立。"),
    guidance: [
      tCurrent("检查主机、端口和认证信息是否正确。"),
      tCurrent("确认服务器 SSH 服务已启动且网络可达。"),
    ],
    technicalDetails: failure.technicalDetails,
    failure,
  };
}

function buildVncErrorPresentation(failure: ConnectionFailure): ConnectionErrorPresentation {
  const { technicalDetails } = failure;

  if (failure.code === "AUTH_REJECTED") {
    return {
      summary: tCurrent("VNC 认证未通过。"),
      guidance: [
        tCurrent("检查连接密码是否正确。"),
        tCurrent("确认目标 VNC 服务端允许当前认证方式。"),
      ],
      technicalDetails,
      failure,
    };
  }

  if (failure.code === "CONNECT_REFUSED") {
    return {
      summary: tCurrent("目标主机拒绝了 VNC 连接。"),
      guidance: [
        tCurrent("确认目标主机已启动 VNC 服务。"),
        tCurrent("确认端口填写正确，默认通常为 5900。"),
        tCurrent("检查目标主机防火墙是否允许该端口。"),
      ],
      technicalDetails,
      failure,
    };
  }

  return {
    summary: tCurrent("VNC 连接未能建立。"),
    guidance: [
      tCurrent("检查目标主机、端口和密码是否正确。"),
      tCurrent("确认网络可达，且目标 VNC 服务已启动。"),
    ],
    technicalDetails,
    failure,
  };
}

function buildTelnetErrorPresentation(failure: ConnectionFailure): ConnectionErrorPresentation {
  return {
    summary: tCurrent("Telnet 连接未能建立。"),
    guidance: [
      tCurrent("检查主机、端口和网络连通性。"),
      tCurrent("确认目标主机已启动 Telnet 服务。"),
    ],
    technicalDetails: failure.technicalDetails,
    failure,
  };
}

function buildSerialErrorPresentation(failure: ConnectionFailure): ConnectionErrorPresentation {
  const summary = failure.code === "DEVICE_BUSY"
    ? tCurrent("串口被其他程序占用。")
    : failure.code === "DEVICE_NOT_FOUND"
      ? tCurrent("找不到指定的串口设备。")
      : failure.code === "DEVICE_REMOVED"
        ? tCurrent("串口设备已断开。")
        : tCurrent("串口连接未能建立。");

  return {
    summary,
    guidance: [
      tCurrent("检查串口设备是否已连接且端口配置正确。"),
      tCurrent("确认串口未被其他程序占用。"),
    ],
    technicalDetails: failure.technicalDetails,
    failure,
  };
}

function buildLocalErrorPresentation(failure: ConnectionFailure): ConnectionErrorPresentation {
  return {
    summary: tCurrent("本地终端启动失败。"),
    guidance: [
      tCurrent("检查默认 Shell 路径是否存在。"),
      tCurrent("管理员模式下，请确认系统允许权限提升。"),
    ],
    technicalDetails: failure.technicalDetails,
    failure,
  };
}
