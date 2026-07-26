import { browser } from 'wxt/browser';
import {
  buildIndex,
  labelDictionaryIndex,
  materializeEntries,
  mergeDictionaryIndexes,
} from './dictionary';
import { getDictionaryCache, setDictionaryCache } from './dictionary-cache';
import { getCvdictCache } from './cvdict-cache';
import { getKaikkiCache } from './kaikki-cache';
import { getSettings } from './settings';
import type {
  AppSettings,
  CompactDictionaryAsset,
  DictionaryAssetMeta,
  DictionaryIndexes,
} from './types';

export type DictionaryLoadStatus = 'cached' | 'built' | 'unavailable';

export interface DictionaryLoadResult {
  /** Compatibility alias for English-only consumers such as Markdown export. */
  index: DictionaryIndexes['english'];
  indexes: DictionaryIndexes;
  status: DictionaryLoadStatus;
  meta: DictionaryAssetMeta | null;
  cvdictEnabled: boolean;
}

const MANIFEST_URL = 'dictionaries/cc-cedict-manifest.json';
const ASSET_URL = 'dictionaries/cc-cedict.compact.json';

/** Fetch and build (or hydrate) the dictionary index for this dashboard session. */
export async function loadDictionary(settings?: AppSettings): Promise<DictionaryLoadResult> {
  const normalizedSettings = settings ?? await getSettings();
  const startedAt = nowMs();
  const vietnamese = await loadVietnamese(normalizedSettings);
  try {
    const manifest = await fetchJson<DictionaryAssetMeta>(MANIFEST_URL);
    if (!manifest) return done(unavailable(vietnamese), startedAt);

    const cached = await getDictionaryCache(manifest.hash);
    if (cached) {
      const english = await withOptionalKaikki(labelDictionaryIndex(cached, 'cc-cedict'), normalizedSettings);
      return done(loaded(english, 'cached', manifest, vietnamese), startedAt);
    }

    const asset = await fetchJson<CompactDictionaryAsset>(ASSET_URL);
    if (!asset) return done(unavailable(vietnamese), startedAt);
    if (asset.meta.hash !== manifest.hash) return done(unavailable(vietnamese), startedAt);

    const entries = materializeEntries(asset);
    const index = buildIndex(entries);
    await setDictionaryCache(manifest.hash, index);
    const english = await withOptionalKaikki(labelDictionaryIndex(index, 'cc-cedict'), normalizedSettings);
    return done(loaded(english, 'built', manifest, vietnamese), startedAt);
  } catch {
    return done(unavailable(vietnamese), startedAt);
  }
}

async function withOptionalKaikki(primary: DictionaryIndexes['english'], settings: AppSettings) {
  if (!primary) return null;
  if (!settings.kaikki.enabled || !settings.kaikki.hash) return primary;
  const cached = await getKaikkiCache(settings.kaikki.hash);
  if (!cached) return primary;
  return mergeDictionaryIndexes(primary, labelDictionaryIndex(cached, 'kaikki'));
}

interface VietnameseLoad {
  index: DictionaryIndexes['vietnamese'];
  enabled: boolean;
}

async function loadVietnamese(settings: AppSettings): Promise<VietnameseLoad> {
  if (!settings.cvdict.enabled || !settings.cvdict.hash) {
    return { index: null, enabled: false };
  }
  try {
    const cached = await getCvdictCache(settings.cvdict.hash!);
    return {
      index: cached ? labelDictionaryIndex(cached, 'cvdict') : null,
      enabled: true,
    };
  } catch {
    return { index: null, enabled: true };
  }
}

function loaded(
  english: DictionaryIndexes['english'],
  status: DictionaryLoadStatus,
  meta: DictionaryAssetMeta,
  vietnamese: VietnameseLoad,
): DictionaryLoadResult {
  return {
    index: english,
    indexes: {
      english,
      vietnamese: vietnamese.index,
    },
    status,
    meta,
    cvdictEnabled: vietnamese.enabled,
  };
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const getUrl = browser.runtime.getURL as (path: string) => string;
  const url = getUrl(path);
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

function unavailable(vietnamese: VietnameseLoad): DictionaryLoadResult {
  return {
    index: null,
    indexes: { english: null, vietnamese: vietnamese.index },
    status: 'unavailable',
    meta: null,
    cvdictEnabled: vietnamese.enabled,
  };
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
