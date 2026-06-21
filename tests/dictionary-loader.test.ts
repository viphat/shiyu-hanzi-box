import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIndex } from '../lib/dictionary';
import { loadDictionary } from '../lib/dictionary-loader';
import { setKaikkiCache } from '../lib/kaikki-cache';
import {
  DEFAULT_SETTINGS,
  recordKaikkiImport,
  settingsStorage,
} from '../lib/settings';
import type { CompactDictionaryAsset, DictionaryAssetMeta, DictionaryEntry } from '../lib/types';

const meta: DictionaryAssetMeta = {
  source: 'CC-CEDICT',
  sourceUrl: '',
  release: '2026-06-20',
  license: 'CC-BY-SA 4.0',
  licenseUrl: '',
  hash: 'hash1',
  generatedAt: '2026-06-20T00:00:00.000Z',
};

const asset: CompactDictionaryAsset = {
  meta,
  columns: {
    simplified: ['你好'],
    traditional: ['你好'],
    pinyin: ['ni3 hao3'],
    definitionRanges: [[0, 1]],
    definitions: ['hello'],
  },
};

const cache = new Map<string, string>();
const kaikkiCache = new Map<string, string>();

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { getURL: (p: string) => 'https://ext/' + p },
  },
}));

describe('loadDictionary', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cache.clear();
    kaikkiCache.clear();
    vi.stubGlobal('__dictCacheStore', {
      get: (k: string) => Promise.resolve(cache.get(k) ?? null),
      set: (k: string, v: string) => {
        cache.set(k, v);
        return Promise.resolve();
      },
      clear: () => Promise.resolve(),
    });
    vi.stubGlobal('__kaikkiCacheStore', {
      get: (k: string) => Promise.resolve(kaikkiCache.get(k) ?? null),
      set: (k: string, v: string) => {
        kaikkiCache.set(k, v);
        return Promise.resolve();
      },
      clear: () => Promise.resolve(),
    });
    await settingsStorage.setValue(DEFAULT_SETTINGS);
  });

  it('fetches the asset, builds the index, and caches it on first load', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => {
        const body = String(url).endsWith('cc-cedict-manifest.json') ? meta : asset;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

    const { index, status } = await loadDictionary();
    expect(status).toBe('built');
    expect(fetchSpy).toHaveBeenCalledWith('https://ext/dictionaries/cc-cedict-manifest.json');
    expect(fetchSpy).toHaveBeenCalledWith('https://ext/dictionaries/cc-cedict.compact.json');
    expect(index!.byForm.get('你好')).toHaveLength(1);
    expect(cache.has('hash1')).toBe(true);
  });

  it('hydrates from the cache when the hash matches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const body = String(url).endsWith('cc-cedict-manifest.json') ? meta : asset;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    await loadDictionary();

    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(meta), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const { index, status } = await loadDictionary();
    expect(status).toBe('cached');
    expect(index!.byForm.get('你好')).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://ext/dictionaries/cc-cedict-manifest.json');
  });

  it('returns unavailable when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const result = await loadDictionary();
    expect(result.index).toBeNull();
    expect(result.status).toBe('unavailable');
  });

  it('returns unavailable when manifest and compact asset hashes differ', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const body = String(url).endsWith('cc-cedict-manifest.json')
        ? meta
        : { ...asset, meta: { ...meta, hash: 'different' } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await loadDictionary();
    expect(result.index).toBeNull();
    expect(result.status).toBe('unavailable');
  });

  it('loads enabled Kaikki entries as fallback when CC-CEDICT misses', async () => {
    await settingsStorage.setValue(recordKaikkiImport(DEFAULT_SETTINGS, {
      sourceUrl: 'https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl',
      sourceName: 'Kaikki Chinese',
      hash: 'kaikki1',
      entryCount: 1,
      importedAt: 100,
    }));
    await setKaikkiCache('kaikki1', buildIndex([
      {
        index: 0,
        traditional: '滞胀',
        simplified: '滞胀',
        pinyin: '',
        definitions: ['stagflation'],
      },
    ]));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const body = String(url).endsWith('cc-cedict-manifest.json') ? meta : asset;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await loadDictionary();
    const hits = result.index!.byForm.get('滞胀')!;
    expect(hits[0]).toMatchObject({
      definitions: ['stagflation'],
      source: 'kaikki',
    });
  });

  it('keeps CC-CEDICT entries before Kaikki entries for the same word', async () => {
    await settingsStorage.setValue(recordKaikkiImport(DEFAULT_SETTINGS, {
      sourceUrl: 'https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl',
      sourceName: 'Kaikki Chinese',
      hash: 'kaikki1',
      entryCount: 1,
      importedAt: 100,
    }));
    const kaikkiEntries: DictionaryEntry[] = [
      {
        index: 0,
        traditional: '你好',
        simplified: '你好',
        pinyin: '',
        definitions: ['Kaikki hello'],
      },
    ];
    await setKaikkiCache('kaikki1', buildIndex(kaikkiEntries));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const body = String(url).endsWith('cc-cedict-manifest.json') ? meta : asset;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await loadDictionary();
    const hits = result.index!.byForm.get('你好')!;
    expect(hits.map((hit) => hit.definitions[0])).toEqual(['hello', 'Kaikki hello']);
    expect(hits.map((hit) => hit.source)).toEqual(['cc-cedict', 'kaikki']);
  });

  it('ignores cached Kaikki entries when the setting is disabled', async () => {
    await setKaikkiCache('kaikki1', buildIndex([
      {
        index: 0,
        traditional: '滞胀',
        simplified: '滞胀',
        pinyin: '',
        definitions: ['stagflation'],
      },
    ]));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const body = String(url).endsWith('cc-cedict-manifest.json') ? meta : asset;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await loadDictionary();
    expect(result.index!.byForm.get('滞胀')).toBeUndefined();
  });
});
