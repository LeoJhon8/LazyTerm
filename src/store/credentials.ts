import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Credential, CredentialInput } from "@/types/credential";
import type { RDPConfig, SSHConfig, VNCConfig } from "@/types/terminal";

interface CredentialsState {
  credentials: Credential[];
  addCredential: (input: CredentialInput) => string;
  updateCredential: (id: string, updates: Partial<CredentialInput>) => void;
  removeCredential: (id: string) => void;
  getCredential: (id?: string) => Credential | undefined;
}

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

export const useCredentialsStore = create<CredentialsState>()(
  persist(
    (set, get) => ({
      credentials: [],

      addCredential: (input) => {
        const now = Date.now();
        const id = createCredentialId();
        const credential: Credential = {
          id,
          ...cleanInput(input),
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({ credentials: [...state.credentials, credential] }));
        return id;
      },

      updateCredential: (id, updates) => set((state) => ({
        credentials: state.credentials.map((credential) =>
          credential.id === id
            ? { ...credential, ...cleanInput({ ...credential, ...updates }), id, createdAt: credential.createdAt, updatedAt: Date.now() }
            : credential
        ),
      })),

      removeCredential: (id) => set((state) => ({
        credentials: state.credentials.filter((credential) => credential.id !== id),
      })),

      getCredential: (id) => {
        if (!id) return undefined;
        return get().credentials.find((credential) => credential.id === id);
      },
    }),
    {
      name: "lazy-term-credentials",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function resolveSshCredential(config: SSHConfig): SSHConfig {
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

export function resolveRdpCredential(config: RDPConfig): RDPConfig {
  const credential = useCredentialsStore.getState().getCredential(config.credentialId);
  if (!credential || credential.type !== "password") return config;

  return {
    ...config,
    username: config.username || credential.username || "",
    password: credential.password,
  };
}

export function resolveVncCredential(config: VNCConfig): VNCConfig {
  const credential = useCredentialsStore.getState().getCredential(config.credentialId);
  if (!credential || credential.type !== "password") return config;

  return {
    ...config,
    password: credential.password,
  };
}
