import { create } from "zustand";
import type {
  Credential,
  CredentialInput,
  CredentialVaultDocument,
} from "@/types/credential";
import type { RDPConfig as TerminalRDPConfig, SSHConfig as TerminalSSHConfig, VNCConfig as TerminalVNCConfig } from "@/types/terminal";
import {
  CREDENTIAL_VAULT_STORAGE_KEY,
  createVaultDocument,
  deriveMasterVaultKey,
  getDefaultVaultKey,
  parseLegacyCredentials,
  parseVaultDocument,
  serializeVaultDocument,
  unlockVaultDocument,
} from "@/lib/credential-vault";
import { logger } from "@/lib/logger";

type VaultStatus = "initializing" | "locked" | "unlocked" | "error";

interface CredentialsState {
  credentials: Credential[];
  vault: CredentialVaultDocument | null;
  status: VaultStatus;
  error: string | null;
  initialize: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  addCredential: (input: CredentialInput) => Promise<string>;
  updateCredential: (id: string, updates: Partial<CredentialInput>) => Promise<void>;
  removeCredential: (id: string) => Promise<void>;
  getCredential: (id?: string) => Credential | undefined;
  enableMasterPassword: (password: string) => Promise<void>;
  changeMasterPassword: (password: string) => Promise<void>;
  disableMasterPassword: () => Promise<void>;
  clearVault: () => Promise<void>;
  importVault: (document: CredentialVaultDocument) => Promise<void>;
}

let activeKey: CryptoKey | null = null;
let initializePromise: Promise<void> | null = null;

function createCredentialId() {
  return `cred_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanInput(input: CredentialInput): CredentialInput {
  return {
    ...input,
    name: input.name.trim(),
    username: input.username?.trim() || undefined,
    password: input.password || undefined,
    privateKeyPath: input.privateKeyPath?.trim() || undefined,
    privateKey: input.privateKey || undefined,
    privateKeyPassphrase: input.privateKeyPassphrase || undefined,
    note: input.note?.trim() || undefined,
  };
}

function persistDocument(document: CredentialVaultDocument) {
  localStorage.setItem(CREDENTIAL_VAULT_STORAGE_KEY, serializeVaultDocument(document));
}

async function saveCredentials(
  mode: CredentialVaultDocument["mode"],
  credentials: Credential[],
  key: CryptoKey,
  kdf?: CredentialVaultDocument["kdf"],
) {
  const document = await createVaultDocument(mode, key, credentials, kdf);
  persistDocument(document);
  return document;
}

export const useCredentialsStore = create<CredentialsState>((set, get) => ({
  credentials: [],
  vault: null,
  status: "initializing",
  error: null,

  initialize: async () => {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      try {
        const raw = localStorage.getItem(CREDENTIAL_VAULT_STORAGE_KEY);
        const document = parseVaultDocument(raw);

        if (document) {
          if (document.mode === "master") {
            activeKey = null;
            set({
              vault: document,
              credentials: document.credentials.map(({ secret: _secret, ...metadata }) => metadata),
              status: "locked",
              error: null,
            });
            return;
          }

          const unlocked = await unlockVaultDocument(document);
          activeKey = unlocked.key;
          set({ vault: document, credentials: unlocked.credentials, status: "unlocked", error: null });
          return;
        }

        const legacyCredentials = parseLegacyCredentials(raw) ?? [];
        const key = await getDefaultVaultKey();
        const migrated = await saveCredentials("default", legacyCredentials, key);
        activeKey = key;
        set({ vault: migrated, credentials: legacyCredentials, status: "unlocked", error: null });
        if (legacyCredentials.length > 0) {
          logger.info("FE/store/credentials", `已将 ${legacyCredentials.length} 条明文凭据迁移为密文`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("FE/store/credentials", "初始化凭据保险库失败", { error });
        set({ status: "error", error: message });
      }
    })().finally(() => {
      initializePromise = null;
    });
    return initializePromise;
  },

  unlock: async (password) => {
    const document = get().vault;
    if (!document) throw new Error("凭据保险库尚未初始化");
    try {
      const unlocked = await unlockVaultDocument(document, password);
      activeKey = unlocked.key;
      set({ credentials: unlocked.credentials, status: "unlocked", error: null });
    } catch {
      throw new Error("主密码不正确，无法解锁凭据");
    }
  },

  addCredential: async (input) => {
    const state = get();
    if (!activeKey || state.status !== "unlocked" || !state.vault) throw new Error("凭据保险库尚未解锁");
    const now = Date.now();
    const id = createCredentialId();
    const credential: Credential = { id, ...cleanInput(input), createdAt: now, updatedAt: now };
    const credentials = [...state.credentials, credential];
    const vault = await saveCredentials(state.vault.mode, credentials, activeKey, state.vault.kdf);
    set({ credentials, vault });
    return id;
  },

  updateCredential: async (id, updates) => {
    const state = get();
    if (!activeKey || state.status !== "unlocked" || !state.vault) throw new Error("凭据保险库尚未解锁");
    const credentials = state.credentials.map((credential) => {
      if (credential.id !== id) return credential;
      const next = cleanInput({ ...credential, ...updates });
      return { ...credential, ...next, id, createdAt: credential.createdAt, updatedAt: Date.now() };
    });
    const vault = await saveCredentials(state.vault.mode, credentials, activeKey, state.vault.kdf);
    set({ credentials, vault });
  },

  removeCredential: async (id) => {
    const state = get();
    if (!activeKey || state.status !== "unlocked" || !state.vault) throw new Error("凭据保险库尚未解锁");
    const credentials = state.credentials.filter((credential) => credential.id !== id);
    const vault = await saveCredentials(state.vault.mode, credentials, activeKey, state.vault.kdf);
    set({ credentials, vault });
  },

  getCredential: (id) => {
    if (!id) return undefined;
    return get().credentials.find((credential) => credential.id === id);
  },

  enableMasterPassword: async (password) => {
    if (!password) throw new Error("主密码不能为空");
    const state = get();
    if (state.status !== "unlocked") throw new Error("凭据保险库尚未解锁");
    const { key, kdf } = await deriveMasterVaultKey(password);
    const vault = await saveCredentials("master", state.credentials, key, kdf);
    activeKey = key;
    set({ vault, error: null });
  },

  changeMasterPassword: async (password) => {
    if (!password) throw new Error("新主密码不能为空");
    const state = get();
    if (state.status !== "unlocked" || state.vault?.mode !== "master") throw new Error("主密码保险库尚未解锁");
    const { key, kdf } = await deriveMasterVaultKey(password);
    const vault = await saveCredentials("master", state.credentials, key, kdf);
    activeKey = key;
    set({ vault, error: null });
  },

  disableMasterPassword: async () => {
    const state = get();
    if (state.status !== "unlocked") throw new Error("凭据保险库尚未解锁");
    const key = await getDefaultVaultKey();
    const vault = await saveCredentials("default", state.credentials, key);
    activeKey = key;
    set({ vault, error: null });
  },

  clearVault: async () => {
    const key = await getDefaultVaultKey();
    const vault = await saveCredentials("default", [], key);
    activeKey = key;
    set({ credentials: [], vault, status: "unlocked", error: null });
  },

  importVault: async (document) => {
    persistDocument(document);
    activeKey = null;
    if (document.mode === "master") {
      set({
        vault: document,
        credentials: document.credentials.map(({ secret: _secret, ...metadata }) => metadata),
        status: "locked",
        error: null,
      });
      return;
    }
    const unlocked = await unlockVaultDocument(document);
    activeKey = unlocked.key;
    set({ vault: document, credentials: unlocked.credentials, status: "unlocked", error: null });
  },
}));

export function exportCredentialVault(): CredentialVaultDocument | null {
  return useCredentialsStore.getState().vault;
}

export async function secureConnectionConfig(
  type: "ssh" | "rdp" | "vnc",
  config: TerminalSSHConfig | TerminalRDPConfig | TerminalVNCConfig,
): Promise<TerminalSSHConfig | TerminalRDPConfig | TerminalVNCConfig> {
  const store = useCredentialsStore.getState();
  const existingId = config.credentialId;
  const name = config.nickname || config.host;

  if (type === "ssh") {
    const sshConfig = config as TerminalSSHConfig;
    const hasSecret = Boolean(sshConfig.password || sshConfig.privateKey || sshConfig.privateKeyPassphrase);
    if (!hasSecret) return sshConfig;
    const input: CredentialInput = {
      name,
      type: sshConfig.authType === "privateKey" ? "ssh-key" : "password",
      username: sshConfig.username,
      password: sshConfig.password,
      privateKeyPath: sshConfig.privateKeyPath,
      privateKey: sshConfig.privateKey,
      privateKeyPassphrase: sshConfig.privateKeyPassphrase,
      note: "由会话配置自动创建",
    };
    const credentialId = existingId && store.getCredential(existingId)
      ? (await store.updateCredential(existingId, input), existingId)
      : await store.addCredential(input);
    return {
      ...sshConfig,
      credentialId,
      password: undefined,
      privateKey: undefined,
      privateKeyPassphrase: undefined,
    };
  }

  const password = (config as TerminalRDPConfig | TerminalVNCConfig).password;
  if (!password) return config;
  const input: CredentialInput = {
    name,
    type: "password",
    username: type === "rdp" ? (config as TerminalRDPConfig).username : undefined,
    password,
    note: "由会话配置自动创建",
  };
  const credentialId = existingId && store.getCredential(existingId)
    ? (await store.updateCredential(existingId, input), existingId)
    : await store.addCredential(input);
  return { ...config, credentialId, password: undefined };
}

export function resolveSshCredential(config: TerminalSSHConfig): TerminalSSHConfig {
  const credential = useCredentialsStore.getState().getCredential(config.credentialId);
  if (!credential) return config;
  return {
    ...config,
    username: config.username || credential.username || "",
    authType: credential.type === "ssh-key" ? "privateKey" : "password",
    password: credential.type === "password" ? credential.password : config.password,
    privateKeyPath: credential.type === "ssh-key" ? credential.privateKeyPath : config.privateKeyPath,
    privateKey: credential.type === "ssh-key" ? credential.privateKey : config.privateKey,
    privateKeyPassphrase: credential.type === "ssh-key" ? credential.privateKeyPassphrase : config.privateKeyPassphrase,
  };
}

export function resolveRdpCredential(config: TerminalRDPConfig): TerminalRDPConfig {
  const credential = useCredentialsStore.getState().getCredential(config.credentialId);
  if (!credential || credential.type !== "password") return config;
  return { ...config, username: config.username || credential.username || "", password: credential.password };
}

export function resolveVncCredential(config: TerminalVNCConfig): TerminalVNCConfig {
  const credential = useCredentialsStore.getState().getCredential(config.credentialId);
  if (!credential || credential.type !== "password") return config;
  return { ...config, password: credential.password };
}
