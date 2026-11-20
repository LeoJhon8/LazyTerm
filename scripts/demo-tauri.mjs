import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const command = process.argv[2];
if (command !== 'dev' && command !== 'build') throw new Error('Expected dev or build');
const extraArgs = process.argv.slice(3);
const separator = extraArgs.indexOf('--');
const cliArgs = separator === -1 ? extraArgs : extraArgs.slice(0, separator);
const runnerArgs = separator === -1 ? [] : extraArgs.slice(separator + 1);
const child = spawn(process.execPath, [
  path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), command,
  '--config', 'src-tauri/tauri.demo.conf.json', ...cliArgs,
  // Both Tauri subcommands forward arguments after -- to Cargo.
  '--', '--no-default-features', ...runnerArgs,
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CARGO_TARGET_DIR: path.join(root, 'src-tauri/target-demo') },
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
