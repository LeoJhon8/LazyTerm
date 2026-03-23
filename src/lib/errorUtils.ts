/**
 * 统一的错误消息提取工具
 * 从 unknown 类型的错误中提取可读的字符串消息
 */

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (typeof error === "object" && error !== null) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "未获取到详细的错误信息。";
}
