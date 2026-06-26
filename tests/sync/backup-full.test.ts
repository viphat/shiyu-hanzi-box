import { describe, expect, it } from 'vitest';
import { BackupParseError, createFullBackup, restoreFullBackup, serializeFullBackup } from '../../lib/backup';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import { EMPTY_INBOX } from '../../lib/types';

describe('full backup envelope', () => {
  it('round-trips inbox, settings, and AI settings', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, apiKey: 'k', enabled: true };
    const raw = serializeFullBackup(EMPTY_INBOX, DEFAULT_SETTINGS, ai);
    const out = restoreFullBackup(raw);
    expect(out.aiSettings?.apiKey).toBe('k');
    expect(out.settings?.uiLocale).toBe(DEFAULT_SETTINGS.uiLocale);
  });

  it('still restores a legacy inbox-only backup without touching settings', () => {
    const legacy = JSON.stringify({
      app: 'shiyu-hanzi-box',
      formatVersion: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      inbox: EMPTY_INBOX,
    });
    const out = restoreFullBackup(legacy);
    expect(out.inbox).toEqual(EMPTY_INBOX);
    expect(out.settings).toBeUndefined();
    expect(out.aiSettings).toBeUndefined();
  });

  it('throws BackupParseError on v3 payload with malformed aiSettings (apiKey not a string)', () => {
    const raw = JSON.stringify({
      app: 'shiyu-hanzi-box',
      formatVersion: 3,
      exportedAt: new Date().toISOString(),
      inbox: EMPTY_INBOX,
      settings: DEFAULT_SETTINGS,
      aiSettings: { enabled: false, provider: 'deepseek', baseUrl: '', apiKey: 99, model: '' },
    });
    expect(() => restoreFullBackup(raw)).toThrow(BackupParseError);
  });

  it('throws BackupParseError on v3 payload with malformed settings (missing uiLocale)', () => {
    const raw = JSON.stringify({
      app: 'shiyu-hanzi-box',
      formatVersion: 3,
      exportedAt: new Date().toISOString(),
      inbox: EMPTY_INBOX,
      settings: { srs: {}, kaikki: {} }, // no uiLocale
      aiSettings: DEFAULT_AI_SETTINGS,
    });
    expect(() => restoreFullBackup(raw)).toThrow(BackupParseError);
  });
});
