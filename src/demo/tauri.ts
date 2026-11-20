import type { ShellInfo } from '@/types/shell';

export async function invokeTauri<T>(command: string, _args?: Record<string, unknown>, _options?: unknown): Promise<T> {
  if (command === 'get_available_shells') {
    return [{ name: 'Demo Shell', path: 'demo', icon_type: 'terminal' }] as ShellInfo[] as T;
  }
  if (command === 'list_serial_ports') return [] as T;
  if (command === 'set_android_ssh_session_count') return undefined as T;
  throw new Error(`LazyTerm Demo: ${command} is unavailable. No backend operation was performed.`);
}
export function invokeTauriSerialized<T>(_queue: string, command: string, args?: Record<string, unknown>, options?: unknown): Promise<T> {
  return invokeTauri(command, args, options);
}
export function invokeTauriBackground(command: string, args?: Record<string, unknown>, options?: unknown): void {
  void invokeTauri(command, args, options).catch(() => undefined);
}
