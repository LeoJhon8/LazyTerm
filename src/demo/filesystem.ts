export const HOME = '/home/demo';
export interface DemoFile { content: string | null }
const hosts = new Map<string, Map<string, DemoFile>>();

export function normalizePath(path: string, cwd = HOME): string {
  const expanded = path.replace(/^~(?=\/|$)/, HOME);
  const segments: string[] = [];
  for (const part of (expanded.startsWith('/') ? expanded : `${cwd}/${expanded}`).split('/')) {
    if (part === '..') segments.pop();
    else if (part && part !== '.') segments.push(part);
  }
  return `/${segments.join('/')}`;
}

export function filesFor(host: string): Map<string, DemoFile> {
  let files = hosts.get(host);
  if (!files) {
    files = new Map([
      ['/', { content: null }], ['/home', { content: null }], [HOME, { content: null }],
      [`${HOME}/logs`, { content: null }], [`${HOME}/uploads`, { content: null }],
      [`${HOME}/README.txt`, { content: 'LazyTerm Demo\nNo real server is connected.\nTry help, ls, cat README.txt or demo-disconnect.\nSFTP uploads appear in this filesystem.\n' }],
      [`${HOME}/logs/app.log`, { content: '2026-01-01T09:00:00Z INFO service ready\n2026-01-01T09:00:01Z INFO GET /health 200\n' }],
      [`${HOME}/config.json`, { content: JSON.stringify({ host, environment: 'demo', port: 8080 }, null, 2) + '\n' }],
    ]);
    hosts.set(host, files);
  }
  return files;
}

export function listDirectory(host: string, path: string) {
  const normalized = normalizePath(path);
  const files = filesFor(host);
  if (files.get(normalized)?.content !== null) throw new Error(`Not a directory: ${normalized}`);
  const prefix = normalized === '/' ? '/' : `${normalized}/`;
  return [...files.entries()].filter(([name]) => name.startsWith(prefix) && name !== normalized && !name.slice(prefix.length).includes('/'))
    .map(([name, file]) => ({ path: name, name: name.slice(prefix.length), is_dir: file.content === null, size: new TextEncoder().encode(file.content ?? '').length }))
    .sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
}
