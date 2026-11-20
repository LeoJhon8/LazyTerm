const values = new Map<string, string>();

export const appStorage: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, String(value)); },
};

const profiles = [
  { id: 'root-folder', type: 'folder', name: 'LazyTerm Demo', parentId: null, isRoot: true, isExpanded: true, order: 0 },
  ...['web.demo', 'database.demo', 'auth-failed.demo'].map((host, index) => ({
    id: `demo-${index}`, type: 'ssh', name: host, parentId: 'root-folder', order: index,
    config: { host, port: 22, username: 'demo', authType: 'password' },
  })),
];
appStorage.setItem('terminal-sessions-v10', JSON.stringify({ state: { nodes: profiles }, version: 0 }));
