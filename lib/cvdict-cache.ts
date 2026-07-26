import {
  clearDictionaryIndexCache,
  getDictionaryIndexCache,
  setDictionaryIndexCache,
  type DictionaryIndexCacheBackend,
} from './dictionary-index-cache';
import type { DictionaryIndex } from './types';

const STORE = 'cvdict-cache' as const;

function backend(): DictionaryIndexCacheBackend | undefined {
  return (globalThis as { __cvdictCacheStore?: DictionaryIndexCacheBackend }).__cvdictCacheStore;
}

export function getCvdictCache(hash: string): Promise<DictionaryIndex | null> {
  return getDictionaryIndexCache(STORE, hash, backend());
}

export function setCvdictCache(hash: string, index: DictionaryIndex): Promise<void> {
  return setDictionaryIndexCache(STORE, hash, index, backend());
}

export function clearCvdictCache(hash: string): Promise<void> {
  return clearDictionaryIndexCache(STORE, hash, backend());
}
