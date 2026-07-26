import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCvdictCache, getCvdictCache, setCvdictCache } from '../lib/cvdict-cache';
import type { DictionaryEntry, DictionaryIndex } from '../lib/types';

const entries: DictionaryEntry[] = [
  { index: 0, traditional: '你好', simplified: '你好', pinyin: 'ni3 hao3', definitions: ['xin chào'] },
];

describe('CVDICT cache serialization boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('round-trips an index and clears it via the injected storage backend', async () => {
    const fakeStore = new Map<string, string>();
    vi.stubGlobal('__cvdictCacheStore', {
      get: (key: string) => Promise.resolve(fakeStore.get(key) ?? null),
      set: (key: string, value: string) => {
        fakeStore.set(key, value);
        return Promise.resolve();
      },
      clear: (key: string) => {
        fakeStore.delete(key);
        return Promise.resolve();
      },
    });

    const index: DictionaryIndex = { byForm: new Map([['你好', entries]]), maxKeyLength: 2 };
    await setCvdictCache('hash123', index);
    expect((await getCvdictCache('hash123'))?.byForm.get('你好')).toEqual(entries);

    await clearCvdictCache('hash123');
    expect(await getCvdictCache('hash123')).toBeNull();
  });
});
