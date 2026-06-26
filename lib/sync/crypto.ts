export interface KdfParams {
  algorithm: 'PBKDF2-HMAC-SHA-256';
  iterations: number;
  salt: string; // base64
}

const PBKDF2_ITERATIONS = 600_000;
const VERIFICATION_PLAINTEXT = 'shiyu-hanzi-box-vault-verification-v1';
const VERIFICATION_AAD = new TextEncoder().encode('verification');

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function defaultKdfParams(): KdfParams {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { algorithm: 'PBKDF2-HMAC-SHA-256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) };
}

export async function deriveKey(passphrase: string, params: KdfParams): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: fromBase64(params.salt) as BufferSource,
      iterations: params.iterations,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJson(
  key: CryptoKey,
  value: unknown,
  aad: Uint8Array,
): Promise<{ nonce: string; ciphertext: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad as BufferSource },
    key,
    plaintext,
  );
  return { nonce: toBase64(nonce), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export async function decryptJson<T>(
  key: CryptoKey,
  nonce: string,
  ciphertext: string,
  aad: Uint8Array,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(nonce) as BufferSource, additionalData: aad as BufferSource },
    key,
    fromBase64(ciphertext) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function makeVerification(
  key: CryptoKey,
): Promise<{ nonce: string; ciphertext: string }> {
  return encryptJson(key, VERIFICATION_PLAINTEXT, VERIFICATION_AAD);
}

export async function checkVerification(
  key: CryptoKey,
  v: { nonce: string; ciphertext: string },
): Promise<boolean> {
  try {
    const out = await decryptJson<string>(key, v.nonce, v.ciphertext, VERIFICATION_AAD);
    return out === VERIFICATION_PLAINTEXT;
  } catch {
    return false;
  }
}
