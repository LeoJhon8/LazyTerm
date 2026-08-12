import { getErrorMessage } from "@/lib/errorUtils";
import type {
  ConnectionErrorCategory,
  ConnectionErrorCode,
  ConnectionFailure,
  ConnectionStage,
  SessionProtocol,
} from "@/types/terminal";

interface FailureDefaults {
  category: ConnectionErrorCategory;
  retryable: boolean;
}

const FAILURE_DEFAULTS: Record<ConnectionErrorCode, FailureDefaults> = {
  DNS_NOT_FOUND: { category: "network", retryable: true },
  NETWORK_UNREACHABLE: { category: "network", retryable: true },
  CONNECT_REFUSED: { category: "network", retryable: true },
  CONNECT_TIMEOUT: { category: "network", retryable: true },
  IO_TIMEOUT: { category: "network", retryable: true },
  REMOTE_CLOSED: { category: "network", retryable: true },
  AUTH_REJECTED: { category: "authentication", retryable: false },
  HOST_KEY_CHANGED: { category: "security", retryable: false },
  CERT_UNTRUSTED: { category: "security", retryable: false },
  PROTOCOL_NEGOTIATION_FAILED: { category: "protocol", retryable: false },
  DEVICE_NOT_FOUND: { category: "device", retryable: true },
  DEVICE_BUSY: { category: "device", retryable: false },
  DEVICE_REMOVED: { category: "device", retryable: true },
  CONFIG_INVALID: { category: "configuration", retryable: false },
  QUEUE_OVERFLOW: { category: "resource", retryable: false },
  INTERNAL_ERROR: { category: "internal", retryable: false },
  UNKNOWN: { category: "internal", retryable: false },
};

export interface ClassifyConnectionFailureOptions {
  stage?: ConnectionStage;
  fallbackCode?: ConnectionErrorCode;
}

export function isConnectionFailure(value: unknown): value is ConnectionFailure {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ConnectionFailure>;
  return typeof candidate.code === "string"
    && typeof candidate.category === "string"
    && typeof candidate.stage === "string"
    && typeof candidate.retryable === "boolean"
    && typeof candidate.technicalDetails === "string";
}

export function createConnectionFailure(
  code: ConnectionErrorCode,
  technicalDetails: string,
  stage: ConnectionStage,
): ConnectionFailure {
  const defaults = FAILURE_DEFAULTS[code];
  return {
    code,
    category: defaults.category,
    stage,
    retryable: defaults.retryable,
    technicalDetails,
  };
}

export function classifyConnectionFailure(
  protocol: SessionProtocol,
  error: unknown,
  options: ClassifyConnectionFailureOptions = {},
): ConnectionFailure {
  if (isConnectionFailure(error)) {
    return error;
  }

  const technicalDetails = getErrorMessage(error);
  const normalized = technicalDetails.toLowerCase();
  const stage = options.stage ?? "transport";

  if (includesAny(normalized, [
    "host key has changed",
    "host key changed",
    "known_hosts mismatch",
    "public key has changed",
    "主机密钥已变更",
    "公钥已变更",
  ])) {
    return createConnectionFailure("HOST_KEY_CHANGED", technicalDetails, "security");
  }

  if (includesAny(normalized, [
    "certificate verify failed",
    "untrusted certificate",
    "certificate mismatch",
    "certificate changed",
    "证书不受信任",
    "证书已变更",
  ])) {
    return createConnectionFailure("CERT_UNTRUSTED", technicalDetails, "security");
  }

  if (protocol === "serial") {
    if (includesAny(normalized, [
      "access is denied",
      "permission denied",
      "sharing violation",
      "used by another process",
      "resource busy",
      "拒绝访问",
      "被其他程序占用",
    ])) {
      return createConnectionFailure("DEVICE_BUSY", technicalDetails, "transport");
    }

    if (includesAny(normalized, [
      "device not found",
      "port not found",
      "no such file",
      "系统找不到指定的文件",
      "设备不存在",
    ])) {
      return createConnectionFailure("DEVICE_NOT_FOUND", technicalDetails, "transport");
    }

    if (includesAny(normalized, [
      "device disconnected",
      "device removed",
      "device does not recognize",
      "device attached to the system is not functioning",
      "semaphore timeout period has expired",
      "设备已断开",
      "设备已拔出",
    ])) {
      return createConnectionFailure("DEVICE_REMOVED", technicalDetails, "steady");
    }
  }

  if (includesAny(normalized, [
    "lookup addr failed",
    "failed to lookup address",
    "socket address not found",
    "name or service not known",
    "no such host",
    "nodename nor servname",
    "dns",
    "主机地址无法解析",
  ])) {
    return createConnectionFailure("DNS_NOT_FOUND", technicalDetails, "resolving");
  }

  if (includesAny(normalized, [
    "network is unreachable",
    "host is unreachable",
    "no route to host",
    "network unreachable",
    "10051",
    "10065",
    "网络不可达",
    "无法访问目标主机",
  ])) {
    return createConnectionFailure("NETWORK_UNREACHABLE", technicalDetails, "transport");
  }

  if (includesAny(normalized, [
    "connection refused",
    "econnrefused",
    "actively refused",
    "10061",
    "目标计算机积极拒绝",
    "拒绝连接",
  ])) {
    return createConnectionFailure("CONNECT_REFUSED", technicalDetails, "transport");
  }

  if (includesAny(normalized, [
    "connection timed out",
    "connect timeout",
    "etimedout",
    "10060",
    "连接超时",
  ])) {
    return createConnectionFailure("CONNECT_TIMEOUT", technicalDetails, "transport");
  }

  if (includesAny(normalized, [
    "read timeout",
    "write timeout",
    "operation timed out",
    "timed out",
    "读取超时",
    "写入超时",
  ])) {
    return createConnectionFailure("IO_TIMEOUT", technicalDetails, stage);
  }

  if (includesAny(normalized, [
    "authentication failed",
    "authentication failure",
    "all authentication methods failed",
    "authentication rejected",
    "permission denied",
    "access denied",
    "invalid credentials",
    "password incorrect",
    "logon failure",
    "credssp",
    "认证失败",
    "密码错误",
    "凭据无效",
  ])) {
    return createConnectionFailure("AUTH_REJECTED", technicalDetails, "authentication");
  }

  if (includesAny(normalized, [
    "handshake failed",
    "tls handshake",
    "negotiation failed",
    "protocol error",
    "begin connection failed",
    "协议错误",
    "协议协商失败",
    "握手失败",
  ])) {
    return createConnectionFailure("PROTOCOL_NEGOTIATION_FAILED", technicalDetails, "security");
  }

  if (includesAny(normalized, [
    "invalid config",
    "invalid server name",
    "configuration is missing",
    "配置不能为空",
    "仅支持密码认证",
  ])) {
    return createConnectionFailure("CONFIG_INVALID", technicalDetails, stage);
  }

  if (includesAny(normalized, [
    "queue full",
    "queue overflow",
    "channel full",
    "队列已满",
  ])) {
    return createConnectionFailure("QUEUE_OVERFLOW", technicalDetails, stage);
  }

  if (includesAny(normalized, [
    "connection reset",
    "connection aborted",
    "econnreset",
    "broken pipe",
    "unexpected eof",
    "channel closed",
    "remote closed",
    "connection closed",
    "连接已断开",
    "连接已关闭",
  ])) {
    const code = protocol === "serial" ? "DEVICE_REMOVED" : "REMOTE_CLOSED";
    return createConnectionFailure(code, technicalDetails, "steady");
  }

  return createConnectionFailure(options.fallbackCode ?? "UNKNOWN", technicalDetails, stage);
}

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}
