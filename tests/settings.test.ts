import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_KAIKKI_SOURCE_URL,
  DEFAULT_SRS_SETTINGS,
  DEFAULT_SETTINGS,
  enableKaikki,
  getSettings,
  mutateSettings,
  normalizeSettings,
  recordKaikkiImport,
  resetKaikki,
  settingsStorage,
  setSrsSettings,
  setUiLocale,
  watchSettings,
} from '../lib/settings';
import type { AppSettings } from '../lib/types';

describe('settings helpers', () => {
  it('defaults to the existing zh-CN UI', () => {
    expect(DEFAULT_SETTINGS.uiLocale).toBe('zh-CN');
    expect(DEFAULT_SETTINGS.kaikki).toMatchObject({
      enabled: false,
      sourceUrl: DEFAULT_KAIKKI_SOURCE_URL,
      sourceName: 'Kaikki Chinese',
      hash: null,
      entryCount: 0,
      importedAt: null,
    });
  });

  it('updates the UI locale immutably', () => {
    const next = setUiLocale(DEFAULT_SETTINGS, 'en');

    expect(next.uiLocale).toBe('en');
    expect(DEFAULT_SETTINGS.uiLocale).toBe('zh-CN');
  });

  it('toggles Kaikki without changing imported metadata', () => {
    const imported = recordKaikkiImport(DEFAULT_SETTINGS, {
      sourceUrl: 'https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl',
      sourceName: 'Kaikki Chinese',
      hash: 'abc123',
      entryCount: 2,
      importedAt: 100,
    });

    expect(enableKaikki(imported, false).kaikki).toMatchObject({
      enabled: false,
      hash: 'abc123',
      entryCount: 2,
    });
  });

  it('records a successful Kaikki import and enables it', () => {
    const next = recordKaikkiImport(DEFAULT_SETTINGS, {
      sourceUrl: 'https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl',
      sourceName: 'Kaikki Chinese',
      hash: 'abc123',
      entryCount: 2,
      importedAt: 100,
    });

    expect(next.kaikki).toEqual({
      enabled: true,
      sourceUrl: 'https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl',
      sourceName: 'Kaikki Chinese',
      hash: 'abc123',
      entryCount: 2,
      importedAt: 100,
    });
  });

  it('resets Kaikki metadata while preserving locale', () => {
    const imported = recordKaikkiImport(setUiLocale(DEFAULT_SETTINGS, 'en'), {
      sourceUrl: 'https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl',
      sourceName: 'Kaikki Chinese',
      hash: 'abc123',
      entryCount: 2,
      importedAt: 100,
    });

    const reset = resetKaikki(imported);
    expect(reset.uiLocale).toBe('en');
    expect(reset.kaikki.hash).toBeNull();
    expect(reset.kaikki.entryCount).toBe(0);
    expect(reset.kaikki.enabled).toBe(false);
  });
});

describe('SRS settings', () => {
  it('exposes default SRS settings with desired retention 0.9', () => {
    expect(DEFAULT_SRS_SETTINGS).toEqual({
      desiredRetention: 0.9,
      maximumIntervalDays: 3650,
      newCardsPerDay: 20,
      enableFuzz: true,
    });
  });

  it('includes srs in DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS.srs).toEqual(DEFAULT_SRS_SETTINGS);
  });

  it('normalizes legacy settings that are missing the srs key', () => {
    const legacy = {
      uiLocale: 'en' as const,
      kaikki: DEFAULT_SETTINGS.kaikki,
    } as unknown as AppSettings;

    const normalized = normalizeSettings(legacy);

    expect(normalized.srs).toEqual(DEFAULT_SRS_SETTINGS);
    expect((legacy as { srs?: unknown }).srs).toBeUndefined();
  });

  it('preserves user-customized srs settings during normalization', () => {
    const customized: AppSettings = {
      uiLocale: 'zh-CN',
      kaikki: DEFAULT_SETTINGS.kaikki,
      srs: {
        desiredRetention: 0.85,
        maximumIntervalDays: 1000,
        newCardsPerDay: 10,
        enableFuzz: true,
      },
    };

    expect(normalizeSettings(customized).srs).toEqual({
      desiredRetention: 0.85,
      maximumIntervalDays: 1000,
      newCardsPerDay: 10,
      enableFuzz: true,
    });
  });

  it('updates SRS settings immutably', () => {
    const next = setSrsSettings(DEFAULT_SETTINGS, {
      ...DEFAULT_SRS_SETTINGS,
      desiredRetention: 0.95,
    });
    expect(next.srs.desiredRetention).toBe(0.95);
    expect(DEFAULT_SETTINGS.srs.desiredRetention).toBe(0.9);
  });
});

describe('normalized settings access', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('normalizes a partial stored object on read', async () => {
    const legacy = {
      uiLocale: 'en',
      kaikki: DEFAULT_SETTINGS.kaikki,
    } as unknown as AppSettings;
    await settingsStorage.setValue(legacy);

    const value = await getSettings();

    expect(value.uiLocale).toBe('en');
    expect(value.srs).toEqual(DEFAULT_SRS_SETTINGS);
  });

  it('normalizes watched values before notifying consumers', async () => {
    const listener = vi.fn();
    const unwatch = watchSettings(listener);

    await settingsStorage.setValue({
      uiLocale: 'en',
      kaikki: DEFAULT_SETTINGS.kaikki,
    } as unknown as AppSettings);

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ srs: DEFAULT_SRS_SETTINGS }),
      );
    });
    unwatch();
  });

  it('normalizes before mutation and persists the complete shape', async () => {
    await settingsStorage.setValue({
      uiLocale: 'zh-CN',
      kaikki: DEFAULT_SETTINGS.kaikki,
    } as unknown as AppSettings);

    await mutateSettings((current) => ({ ...current, uiLocale: 'en' }));

    expect(await settingsStorage.getValue()).toMatchObject({
      uiLocale: 'en',
      srs: DEFAULT_SRS_SETTINGS,
    });
  });
});
