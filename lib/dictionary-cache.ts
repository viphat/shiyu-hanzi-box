import type { DictionaryEntry, DictionaryIndex } from './types';

const DB_NAME = 'shiyu-hanzi-box';
const STORE = 'dictionary-cache';

/**
 * Minimal storage backend interface. In the dashboard this is backed by
 * IndexedDB; tests inject a fake. Keeping the boundary narrow keeps the
 * serialization logic pure and unit-testable.
 */
interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  clear(key: string): Promise<void>;
}

function backend(): CacheBackend {
  const injected = (globalThis as { __dictCacheStore?: CacheBackend }).__dictCacheStore;
  if (injected) return injected;
  return indexedDbBackend();
}

function indexedDbBackend(): CacheBackend {
  return {
    async get(key) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as string) ?? null);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key, value) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async clear(key) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Serialized shape: `Map` does not survive JSON, so it is an array of pairs. */
interface SerializedIndex {
  v: 1;
  pairs: Array<[string, DictionaryEntry[]]>;
  maxKeyLength: number;
}

export async function getDictionaryCache(
  hash: string,
): Promise<DictionaryIndex | null> {
  const raw = await backend().get(hash);
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

export async function setDictionaryCache(
  hash: string,
  index: DictionaryIndex,
): Promise<void> {
  const serialized: SerializedIndex = {
    v: 1,
    pairs: Array.from(index.byForm.entries()),
    maxKeyLength: index.maxKeyLength,
  };
  await backend().set(hash, JSON.stringify(serialized));
}

export async function clearDictionaryCache(hash: string): Promise<void> {
  await backend().clear(hash);
}
