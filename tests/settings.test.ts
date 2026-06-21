import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KAIKKI_SOURCE_URL,
  DEFAULT_SETTINGS,
  enableKaikki,
  recordKaikkiImport,
  resetKaikki,
  setUiLocale,
} from '../lib/settings';

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
