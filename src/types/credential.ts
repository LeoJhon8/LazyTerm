export type CredentialType = "password" | "ssh-key";

export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export type CredentialInput = Omit<Credential, "id" | "createdAt" | "updatedAt">;
