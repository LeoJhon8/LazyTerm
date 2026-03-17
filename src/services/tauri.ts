import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";

interface InvokeLogOptions {
  scope?: string;
  logStart?: boolean;
  logSuccess?: boolean;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (typeof error === "object" && error !== null) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "unknown invoke error";
}

export async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
  options: InvokeLogOptions = {}
): Promise<T> {
  const scope = options.scope ?? `TAURI/${command}`;

  if (options.logStart) {
    logger.info(scope, `invoke start: ${command}`);
  }

  try {
    const result = await invoke<T>(command, args);
    if (options.logSuccess) {
      logger.info(scope, `invoke success: ${command}`);
    }
    return result;
  } catch (error) {
    logger.error(scope, `invoke failed: ${command}`, getErrorMessage(error));
    throw error;
  }
}

export function invokeTauriBackground(
  command: string,
  args?: Record<string, unknown>,
  options: InvokeLogOptions = {}
): void {
  void invokeTauri(command, args, options);
}
