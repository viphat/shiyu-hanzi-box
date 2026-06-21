import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDictionaryCache, getDictionaryCache, setDictionaryCache } from '../lib/dictionary-cache';
import type { DictionaryEntry, DictionaryIndex } from '../lib/types';

const entries: DictionaryEntry[] = [
  { index: 0, traditional: '你好', simplified: '你好', pinyin: 'ni3 hao3', definitions: ['hello'] },
];

describe('dictionary cache serialization boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('serializes and deserializes an index round-trip via a fake storage backend', async () => {
    const fakeStore = new Map<string, string>();
    vi.stubGlobal('__dictCacheStore', {
      get: (k: string) => Promise.resolve(fakeStore.get(k) ?? null),
      set: (k: string, v: string) => {
        fakeStore.set(k, v);
        return Promise.resolve();
      },
      clear: (k: string) => {
        fakeStore.delete(k);
        return Promise.resolve();
      },
    });

    const index: DictionaryIndex = { byForm: new Map([['你好', entries]]), maxKeyLength: 2 };
    await setDictionaryCache('hash123', index);
    const restored = await getDictionaryCache('hash123');
    expect(restored).not.toBeNull();
    expect(restored!.byForm.get('你好')).toEqual(entries);
    expect(restored!.maxKeyLength).toBe(2);

    await clearDictionaryCache('hash123');
    expect(await getDictionaryCache('hash123')).toBeNull();
  });
});
