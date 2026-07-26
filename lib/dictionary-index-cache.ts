import type { DictionaryEntry, DictionaryIndex } from './types';

export type DictionaryIndexStore = 'dictionary-cache' | 'kaikki-cache' | 'cvdict-cache';

export interface DictionaryIndexCacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  clear(key: string): Promise<void>;
}

const DB_NAME = 'shiyu-hanzi-box';
const DB_VERSION = 3;
const STORES: readonly DictionaryIndexStore[] = [
  'dictionary-cache',
  'kaikki-cache',
  'cvdict-cache',
];

/** Serialized shape: `Map` does not survive JSON, so it is an array of pairs. */
interface SerializedIndex {
  v: 1;
  pairs: Array<[string, DictionaryEntry[]]>;
  maxKeyLength: number;
}

export function getDictionaryIndexCache(
  store: DictionaryIndexStore,
  hash: string,
  injected?: DictionaryIndexCacheBackend,
): Promise<DictionaryIndex | null> {
  return getIndex(injected ?? indexedDbBackend(store), hash);
}

export function setDictionaryIndexCache(
  store: DictionaryIndexStore,
  hash: string,
  index: DictionaryIndex,
  injected?: DictionaryIndexCacheBackend,
): Promise<void> {
  const serialized: SerializedIndex = {
    v: 1,
    pairs: Array.from(index.byForm.entries()),
    maxKeyLength: index.maxKeyLength,
  };
  return (injected ?? indexedDbBackend(store)).set(hash, JSON.stringify(serialized));
}

export function clearDictionaryIndexCache(
  store: DictionaryIndexStore,
  hash: string,
  injected?: DictionaryIndexCacheBackend,
): Promise<void> {
  return (injected ?? indexedDbBackend(store)).clear(hash);
}

async function getIndex(
  backend: DictionaryIndexCacheBackend,
  hash: string,
): Promise<DictionaryIndex | null> {
  const raw = await backend.get(hash);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SerializedIndex;
    return {
      byForm: new Map(parsed.pairs),
      maxKeyLength: parsed.maxKeyLength,
    };
  } catch {
    return null;
  }
}

function indexedDbBackend(store: DictionaryIndexStore): DictionaryIndexCacheBackend {
  return {
    async get(key) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve((req.result as string) ?? null);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key, value) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async clear(key) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
