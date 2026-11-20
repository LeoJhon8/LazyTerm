function unavailable(): never { throw new Error('LazyTerm Demo: this operation is unavailable; no external action was performed.'); }
export async function fetch(..._args: unknown[]): Promise<Response> { return unavailable(); }
export async function readTextFile(..._args: unknown[]): Promise<string> { return unavailable(); }
export async function writeTextFile(..._args: unknown[]): Promise<void> { return unavailable(); }
export async function readDir(..._args: unknown[]): Promise<never[]> { return unavailable(); }
export async function stat(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function exists(..._args: unknown[]): Promise<boolean> { return unavailable(); }
// Cancelling unsupported pickers preserves their callers' existing cancel handling.
export async function open(..._args: unknown[]): Promise<null> { return null; }
export async function save(..._args: unknown[]): Promise<null> { return null; }
export async function openUrl(..._args: unknown[]): Promise<void> { return unavailable(); }
export async function checkGitRepo(..._args: unknown[]): Promise<boolean> { return unavailable(); }
export async function commitAndPushGitRepo(..._args: unknown[]): Promise<void> { return unavailable(); }
export async function pullGitRepo(..._args: unknown[]): Promise<void> { return unavailable(); }
