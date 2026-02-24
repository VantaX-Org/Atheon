/**
 * Encryption at Rest Service
 * AES-256-GCM encryption for sensitive data (ERP tokens, webhook secrets, etc.)
 * Uses Web Crypto API for edge-compatible encryption.
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for AES-GCM
const TAG_LENGTH = 128; // bits

/**
 * Derive an encryption key from the JWT_SECRET using HKDF.
 * This creates a deterministic but separate key for encryption.
 */
async function deriveEncryptionKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(secret), 'HKDF', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('atheon-encryption-salt-v1'),
      info: enc.encode('atheon-data-encryption'),
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded string in format: "enc:v1:<iv>:<ciphertext>"
 */
export async function encrypt(plaintext: string, secret: string): Promise<string> {
  const key = await deriveEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const enc = new TextEncoder();

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    enc.encode(plaintext),
  );

  const ivB64 = arrayBufferToBase64(iv.buffer);
  const ctB64 = arrayBufferToBase64(ciphertext);
  return `enc:v1:${ivB64}:${ctB64}`;
}

/**
 * Decrypt an encrypted string.
 * Expects format: "enc:v1:<iv>:<ciphertext>"
 * Returns null if decryption fails or input is not encrypted.
 */
export async function decrypt(encrypted: string, secret: string): Promise<string | null> {
  if (!encrypted.startsWith('enc:v1:')) return encrypted; // Not encrypted, return as-is

  const parts = encrypted.split(':');
  if (parts.length !== 4) return null;

  const ivB64 = parts[2];
  const ctB64 = parts[3];

  try {
    const key = await deriveEncryptionKey(secret);
    const iv = new Uint8Array(base64ToArrayBuffer(ivB64));
    const ciphertext = base64ToArrayBuffer(ctB64);

    const plaintext = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/**
 * Check if a value is already encrypted.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith('enc:v1:');
}

/**
 * Encrypt a JSON object's sensitive fields.
 * Only encrypts specified field names.
 */
export async function encryptFields(
  obj: Record<string, unknown>,
  sensitiveFields: string[],
  secret: string,
): Promise<Record<string, unknown>> {
  const result = { ...obj };
  for (const field of sensitiveFields) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0 && !isEncrypted(value)) {
      result[field] = await encrypt(value, secret);
    }
  }
  return result;
}

/**
 * Decrypt a JSON object's sensitive fields.
 */
export async function decryptFields(
  obj: Record<string, unknown>,
  sensitiveFields: string[],
  secret: string,
): Promise<Record<string, unknown>> {
  const result = { ...obj };
  for (const field of sensitiveFields) {
    const value = result[field];
    if (typeof value === 'string' && isEncrypted(value)) {
      const decrypted = await decrypt(value, secret);
      if (decrypted !== null) result[field] = decrypted;
    }
  }
  return result;
}
