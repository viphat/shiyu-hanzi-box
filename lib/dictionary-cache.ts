import {
  clearDictionaryIndexCache,
  getDictionaryIndexCache,
  setDictionaryIndexCache,
  type DictionaryIndexCacheBackend,
} from './dictionary-index-cache';
import type { DictionaryIndex } from './types';

const STORE = 'dictionary-cache' as const;

function backend(): DictionaryIndexCacheBackend | undefined {
  return (globalThis as { __dictCacheStore?: DictionaryIndexCacheBackend }).__dictCacheStore;
}

export function getDictionaryCache(hash: string): Promise<DictionaryIndex | null> {
  return getDictionaryIndexCache(STORE, hash, backend());
}

export function setDictionaryCache(hash: string, index: DictionaryIndex): Promise<void> {
  return setDictionaryIndexCache(STORE, hash, index, backend());
}

export function clearDictionaryCache(hash: string): Promise<void> {
  return clearDictionaryIndexCache(STORE, hash, backend());
}
