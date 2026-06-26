import { storage } from 'wxt/utils/storage';
import type { SyncError, SyncStatus } from './types';

export interface SyncConfig {
  vaultId: string | null;
  replicaId: string;
  replicaLabel: string;
  folderName: string | null;
  lastSuccessAt: number | null;
  pending: boolean;
  status: SyncStatus;
  lastError: SyncError | null;
  localRevision: number;
}

const FALLBACK: SyncConfig = {
  vaultId: null,
  replicaId: '',
  replicaLabel: '',
  folderName: null,
  lastSuccessAt: null,
  pending: false,
  status: 'disabled',
  lastError: null,
  localRevision: 0,
};

export const syncConfigStorage = storage.defineItem<SyncConfig>('local:syncConfig', {
  fallback: FALLBACK,
});

export async function getSyncConfig(): Promise<SyncConfig> {
  return syncConfigStorage.getValue();
}

export async function setSyncConfig(next: SyncConfig): Promise<void> {
  await syncConfigStorage.setValue(next);
}

let chain: Promise<unknown> = Promise.resolve();
export async function mutateSyncConfig(
  fn: (cfg: SyncConfig) => SyncConfig,
): Promise<SyncConfig> {
  const run = chain.then(() => getSyncConfig()).then((cfg) => fn(cfg));
  chain = run.then(setSyncConfig);
  return run;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function makeReplicaId(wallTime: number, random: Uint8Array): string {
  // 48-bit timestamp (10 chars) + 80-bit randomness (16 chars) = 26-char ULID.
  let time = '';
  let t = wallTime;
  for (let i = 9; i >= 0; i -= 1) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  let bits = 0;
  let acc = 0;
  for (const byte of random) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand += CROCKFORD[(acc >> bits) & 31];
    }
  }
  return (time + rand).slice(0, 26);
}

export async function ensureReplicaId(): Promise<string> {
  const cfg = await getSyncConfig();
  if (cfg.replicaId) return cfg.replicaId;
  const id = makeReplicaId(Date.now(), crypto.getRandomValues(new Uint8Array(10)));
  await mutateSyncConfig((c) => ({ ...c, replicaId: id }));
  return id;
}

// --- IndexedDB for non-serializable handles and CryptoKey ---

const DB_NAME = 'shiyu-sync';
const STORE = 'handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const value = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export const saveDirectoryHandle = (h: FileSystemDirectoryHandle) => idbPut('dir', h);
export const loadDirectoryHandle = () => idbGet<FileSystemDirectoryHandle>('dir');
export const clearDirectoryHandle = () => idbDelete('dir');
export const rememberKey = (k: CryptoKey) => idbPut('key', k);
export const recallKey = () => idbGet<CryptoKey>('key');
export const forgetKey = () => idbDelete('key');
