import { storage } from 'wxt/utils/storage';
import type {
  AppSettings,
  KaikkiSettings,
  SrsSettings,
  UiLocale,
} from './types';

export const DEFAULT_KAIKKI_SOURCE_URL =
  'https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl';

export const DEFAULT_KAIKKI_SETTINGS: KaikkiSettings = {
  enabled: false,
  sourceUrl: DEFAULT_KAIKKI_SOURCE_URL,
  sourceName: 'Kaikki Chinese',
  hash: null,
  entryCount: 0,
  importedAt: null,
};

export const DEFAULT_SRS_SETTINGS: SrsSettings = {
  desiredRetention: 0.9,
  maximumIntervalDays: 3650,
  newCardsPerDay: 20,
  enableFuzz: true,
};

export const DEFAULT_SETTINGS: AppSettings = {
  uiLocale: 'zh-CN',
  kaikki: DEFAULT_KAIKKI_SETTINGS,
  srs: DEFAULT_SRS_SETTINGS,
};

export const settingsStorage = storage.defineItem<AppSettings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

export function setUiLocale(settings: AppSettings, uiLocale: UiLocale): AppSettings {
  return { ...settings, uiLocale };
}

export function enableKaikki(settings: AppSettings, enabled: boolean): AppSettings {
  return {
    ...settings,
    kaikki: { ...settings.kaikki, enabled },
  };
}

export function recordKaikkiImport(
  settings: AppSettings,
  metadata: Omit<KaikkiSettings, 'enabled'>,
): AppSettings {
  return {
    ...settings,
    kaikki: {
      enabled: true,
      ...metadata,
    },
  };
}

export function resetKaikki(settings: AppSettings): AppSettings {
  return {
    ...settings,
    kaikki: DEFAULT_KAIKKI_SETTINGS,
  };
}

type StoredAppSettings = Partial<Omit<AppSettings, 'kaikki' | 'srs'>> & {
  kaikki?: Partial<KaikkiSettings>;
  srs?: Partial<SrsSettings>;
};

export function normalizeSettings(
  value: StoredAppSettings | undefined | null,
): AppSettings {
  return {
    uiLocale: value?.uiLocale ?? DEFAULT_SETTINGS.uiLocale,
    kaikki: { ...DEFAULT_KAIKKI_SETTINGS, ...value?.kaikki },
    srs: { ...DEFAULT_SRS_SETTINGS, ...value?.srs },
  };
}

export function setSrsSettings(
  settings: AppSettings,
  srs: SrsSettings,
): AppSettings {
  return { ...settings, srs };
}
