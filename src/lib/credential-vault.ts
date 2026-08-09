import type {
  Credential,
  CredentialInput,
  CredentialMetadata,
  CredentialSecret,
  CredentialVaultDocument,
  CredentialVaultKdf,
  EncryptedCredentialSecret,
  PersistedCredential,
} from "@/types/credential";

export const CREDENTIAL_VAULT_STORAGE_KEY = "lazy-term-credentials";

const DEFAULT_KEY_MATERIAL = "LazyTerm credential vault default key v1";
const MASTER_KEY_ITERATIONS = 310_000;
const VERIFIER_TEXT = "LazyTerm credential vault verifier v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function importAesKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function getDefaultVaultKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(DEFAULT_KEY_MATERIAL));
  return importAesKey(digest);
}

export async function deriveMasterVaultKey(
  password: string,
  existingKdf?: CredentialVaultKdf,
): Promise<{ key: CryptoKey; kdf: CredentialVaultKdf }> {
  const salt = existingKdf ? base64ToBytes(existingKdf.salt) : randomBytes(16);
  const iterations = existingKdf?.iterations ?? MASTER_KEY_ITERATIONS;
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return {
    key,
    kdf: {
      algorithm: "PBKDF2-SHA-256",
      salt: bytesToBase64(salt),
      iterations,
    },
  };
}

async function encryptText(key: CryptoKey, plaintext: string, aad: string): Promise<EncryptedCredentialSecret> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptText(key: CryptoKey, encrypted: EncryptedCredentialSecret, aad: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64ToBytes(encrypted.iv)),
      additionalData: encoder.encode(aad),
    },
    key,
    toArrayBuffer(base64ToBytes(encrypted.ciphertext)),
  );
  return decoder.decode(plaintext);
}

function getSecret(credential: Credential | CredentialInput): CredentialSecret {
  return {
    password: credential.password || undefined,
    apiKey: credential.apiKey || undefined,
    privateKey: credential.privateKey || undefined,
    privateKeyPassphrase: credential.privateKeyPassphrase || undefined,
  };
}

function getMetadata(credential: Credential): CredentialMetadata {
  return {
    id: credential.id,
    name: credential.name,
    type: credential.type,
    username: credential.username || undefined,
    privateKeyPath: credential.privateKeyPath || undefined,
    note: credential.note || undefined,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

export async function encryptCredential(key: CryptoKey, credential: Credential): Promise<PersistedCredential> {
  return {
    ...getMetadata(credential),
    secret: await encryptText(key, JSON.stringify(getSecret(credential)), `credential:${credential.id}`),
  };
}

export async function decryptCredential(key: CryptoKey, credential: PersistedCredential): Promise<Credential> {
  const secret = JSON.parse(
    await decryptText(key, credential.secret, `credential:${credential.id}`),
  ) as CredentialSecret;
  const { secret: _encryptedSecret, ...metadata } = credential;
  return { ...metadata, ...secret };
}

export async function createVaultDocument(
  mode: CredentialVaultDocument["mode"],
  key: CryptoKey,
  credentials: Credential[],
  kdf?: CredentialVaultKdf,
): Promise<CredentialVaultDocument> {
  return {
    version: 1,
    mode,
    kdf,
    verifier: await encryptText(key, VERIFIER_TEXT, "vault-verifier"),
    credentials: await Promise.all(credentials.map((credential) => encryptCredential(key, credential))),
  };
}

export async function unlockVaultDocument(
  document: CredentialVaultDocument,
  password?: string,
): Promise<{ key: CryptoKey; credentials: Credential[] }> {
  const key = document.mode === "master"
    ? (await deriveMasterVaultKey(password ?? "", document.kdf)).key
    : await getDefaultVaultKey();
  const verifier = await decryptText(key, document.verifier, "vault-verifier");
  if (verifier !== VERIFIER_TEXT) throw new Error("凭据主密码不正确");
  const credentials = await Promise.all(
    document.credentials.map((credential) => decryptCredential(key, credential)),
  );
  return { key, credentials };
}

export function parseVaultDocument(raw: string | null): CredentialVaultDocument | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as { version?: number; state?: unknown };
  if (candidate.version === 1 && "mode" in candidate) {
    return candidate as CredentialVaultDocument;
  }
  return null;
}

export function parseLegacyCredentials(raw: string | null): Credential[] | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { state?: { credentials?: Credential[] }; credentials?: Credential[] };
  const credentials = parsed.state?.credentials ?? parsed.credentials;
  return Array.isArray(credentials) ? credentials : null;
}

export function serializeVaultDocument(document: CredentialVaultDocument): string {
  return JSON.stringify(document);
}
