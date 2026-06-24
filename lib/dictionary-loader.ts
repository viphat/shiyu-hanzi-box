import { browser } from 'wxt/browser';
import {
  buildIndex,
  labelDictionaryIndex,
  materializeEntries,
  mergeDictionaryIndexes,
} from './dictionary';
import { getDictionaryCache, setDictionaryCache } from './dictionary-cache';
import { getKaikkiCache } from './kaikki-cache';
import { getSettings } from './settings';
import type { CompactDictionaryAsset, DictionaryAssetMeta, DictionaryIndex } from './types';

export type DictionaryLoadStatus = 'cached' | 'built' | 'unavailable';

export interface DictionaryLoadResult {
  index: DictionaryIndex | null;
  status: DictionaryLoadStatus;
  meta: DictionaryAssetMeta | null;
}

const MANIFEST_URL = 'dictionaries/cc-cedict-manifest.json';
const ASSET_URL = 'dictionaries/cc-cedict.compact.json';

/** Fetch and build (or hydrate) the dictionary index for this dashboard session. */
export async function loadDictionary(): Promise<DictionaryLoadResult> {
  const startedAt = nowMs();
  try {
    const manifest = await fetchJson<DictionaryAssetMeta>(MANIFEST_URL);
    if (!manifest) return done(unavailable(), startedAt);

    const cached = await getDictionaryCache(manifest.hash);
    if (cached) {
      const index = await withOptionalKaikki(labelDictionaryIndex(cached, 'cc-cedict'));
      return done({ index, status: 'cached', meta: manifest }, startedAt);
    }

    const asset = await fetchJson<CompactDictionaryAsset>(ASSET_URL);
    if (!asset) return done(unavailable(), startedAt);
    if (asset.meta.hash !== manifest.hash) return done(unavailable(), startedAt);

    const entries = materializeEntries(asset);
    const index = buildIndex(entries);
    await setDictionaryCache(manifest.hash, index);
    const merged = await withOptionalKaikki(labelDictionaryIndex(index, 'cc-cedict'));
    return done({ index: merged, status: 'built', meta: manifest }, startedAt);
  } catch {
    return done(unavailable(), startedAt);
  }
}

async function withOptionalKaikki(primary: DictionaryIndex): Promise<DictionaryIndex> {
  const settings = await getSettings();
  if (!settings.kaikki.enabled || !settings.kaikki.hash) return primary;
  const cached = await getKaikkiCache(settings.kaikki.hash);
  if (!cached) return primary;
  return mergeDictionaryIndexes(primary, labelDictionaryIndex(cached, 'kaikki'));
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const getUrl = browser.runtime.getURL as (path: string) => string;
  const url = getUrl(path);
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

function unavailable(): DictionaryLoadResult {
  return { index: null, status: 'unavailable', meta: null };
}

function done(result: DictionaryLoadResult, startedAt: number): DictionaryLoadResult {
  if (import.meta.env.DEV) {
    console.debug(
      `[dictionary-loader] status=${result.status} initMs=${Math.round(nowMs() - startedAt)}`,
    );
  }
  return result;
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
