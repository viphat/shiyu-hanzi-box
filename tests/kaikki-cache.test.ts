import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIndex } from '../lib/dictionary';
import {
  clearKaikkiCache,
  getKaikkiCache,
  setKaikkiCache,
} from '../lib/kaikki-cache';
import type { DictionaryEntry } from '../lib/types';

const entries: DictionaryEntry[] = [
  {
    index: 0,
    traditional: '滯脹',
    simplified: '滞胀',
    pinyin: '',
    definitions: ['stagflation'],
  },
];

describe('kaikki cache serialization boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('serializes and deserializes an index round-trip via a fake storage backend', async () => {
    const fakeStore = new Map<string, string>();
    vi.stubGlobal('__kaikkiCacheStore', {
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

    const index = buildIndex(entries);
    await setKaikkiCache('hash123', index);
    const restored = await getKaikkiCache('hash123');

    expect(restored).not.toBeNull();
    expect(restored!.byForm.get('滞胀')).toEqual(entries);
    expect(restored!.byForm.get('滯脹')).toEqual(entries);

    await clearKaikkiCache('hash123');
    expect(await getKaikkiCache('hash123')).toBeNull();
  });
});
