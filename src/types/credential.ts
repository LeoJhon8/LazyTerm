export type CredentialType = "password" | "ssh-key" | "api-key";

export interface CredentialMetadata {
  id: string;
  name: string;
  type: CredentialType;
  username?: string;
  privateKeyPath?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CredentialSecret {
  password?: string;
  apiKey?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
}

export interface Credential extends CredentialMetadata, CredentialSecret {}

export type CredentialInput = Omit<Credential, "id" | "createdAt" | "updatedAt">;

export interface EncryptedCredentialSecret {
  iv: string;
  ciphertext: string;
}

export interface PersistedCredential extends CredentialMetadata {
  secret: EncryptedCredentialSecret;
}

export type CredentialVaultMode = "default" | "master";

export interface CredentialVaultKdf {
  algorithm: "PBKDF2-SHA-256";
  salt: string;
  iterations: number;
}

export interface CredentialVaultDocument {
  version: 1;
  mode: CredentialVaultMode;
  kdf?: CredentialVaultKdf;
  verifier: EncryptedCredentialSecret;
  credentials: PersistedCredential[];
}
