import { decryptJson, encryptJson, isValidKdfParams, type KdfParams } from './crypto';
import { APP_ID, SYNC_FORMAT_VERSION, VAULT_FORMAT_VERSION, type SyncReplica } from './types';

export interface VaultManifest {
  app: typeof APP_ID;
  vaultFormatVersion: 1;
  vaultId: string;
  kdf: KdfParams;
  cipher: 'AES-256-GCM';
  verification: { nonce: string; ciphertext: string };
}

export const REPLICA_FILENAME = /^[0-9A-HJKMNP-TV-Z]{26}\.shiyu$/;

export function isReplicaFilename(name: string): boolean {
  return REPLICA_FILENAME.test(name);
}

export function isVaultManifest(value: unknown): value is VaultManifest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.app === APP_ID &&
    v.vaultFormatVersion === VAULT_FORMAT_VERSION &&
    typeof v.vaultId === 'string' &&
    v.cipher === 'AES-256-GCM' &&
    isValidKdfParams(v.kdf) &&
    !!v.verification &&
    typeof v.verification === 'object'
  );
}

export function replicaAad(vaultId: string, replicaId: string): Uint8Array {
  return new TextEncoder().encode(`${APP_ID}|${SYNC_FORMAT_VERSION}|${vaultId}|${replicaId}`);
}

interface ReplicaFile {
  header: { app: typeof APP_ID; formatVersion: 1; vaultId: string; replicaId: string };
  nonce: string;
  ciphertext: string;
}

export async function encryptReplica(key: CryptoKey, replica: SyncReplica): Promise<string> {
  const aad = replicaAad(replica.vaultId, replica.replicaId);
  const { nonce, ciphertext } = await encryptJson(key, replica, aad);
  const file: ReplicaFile = {
    header: {
      app: APP_ID,
      formatVersion: SYNC_FORMAT_VERSION,
      vaultId: replica.vaultId,
      replicaId: replica.replicaId,
    },
    nonce,
    ciphertext,
  };
  return JSON.stringify(file);
}

export async function decryptReplica(
  key: CryptoKey,
  raw: string,
  expected: { vaultId: string },
): Promise<SyncReplica> {
  let file: ReplicaFile;
  try {
    file = JSON.parse(raw) as ReplicaFile;
  } catch {
    throw new Error('replica-incompatible');
  }
  if (file.header?.app !== APP_ID || file.header.formatVersion !== SYNC_FORMAT_VERSION) {
    throw new Error('replica-incompatible');
  }
  if (file.header.vaultId !== expected.vaultId) {
    throw new Error('vault-invalid');
  }
  const aad = replicaAad(file.header.vaultId, file.header.replicaId);
  const replica = await decryptJson<SyncReplica>(key, file.nonce, file.ciphertext, aad);
  if (replica.vaultId !== expected.vaultId || replica.replicaId !== file.header.replicaId) {
    throw new Error('vault-invalid');
  }
  return replica;
}
