import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errorUtils";

interface InvokeLogOptions {
  scope?: string;
  logStart?: boolean;
  logSuccess?: boolean;
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
