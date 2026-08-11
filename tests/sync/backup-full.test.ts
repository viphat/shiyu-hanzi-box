import { describe, expect, it } from 'vitest';
import { BackupParseError, createFullBackup, restoreFullBackup, serializeFullBackup } from '../../lib/backup';
import { EMPTY_DRIFT_STORE } from '../../lib/drift';
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

describe('drift in the full backup', () => {
  const drift = { weights: { '你好': 2 as const }, days: { '2026-08-11': 5 } };

  it('round-trips drift state at v4', () => {
    const raw = serializeFullBackup(EMPTY_INBOX, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, drift);
    expect(JSON.parse(raw).formatVersion).toBe(4);
    expect(restoreFullBackup(raw).drift).toEqual(drift);
  });

  it('still restores a v3 backup WITH its settings and API key', () => {
    // The regression guard: a naive version bump sends v3 down the inbox-only
    // fallback and silently drops settings + aiSettings.
    const v3 = JSON.stringify({
      app: 'shiyu-hanzi-box',
      formatVersion: 3,
      exportedAt: '2026-07-01T00:00:00.000Z',
      inbox: EMPTY_INBOX,
      settings: DEFAULT_SETTINGS,
      aiSettings: { ...DEFAULT_AI_SETTINGS, apiKey: 'sk-secret' },
    });
    const out = restoreFullBackup(v3);
    expect(out.settings).toBeDefined();
    expect(out.aiSettings?.apiKey).toBe('sk-secret');
    // A v3 file has no `drift` key at all — this must come back `undefined`,
    // not an implied empty store, or a caller that treats "empty" and
    // "absent" the same way wipes the user's whole drift history on restore.
    expect(out.drift).toBeUndefined();
  });

  it('returns an explicit (not undefined) empty drift store when the v4 file carries one', () => {
    // Distinguishes "the backup carried an empty drift store" (wipe) from
    // "the backup predates Drift" (leave local store alone) — the two must
    // not collapse to the same return value.
    const raw = serializeFullBackup(EMPTY_INBOX, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, EMPTY_DRIFT_STORE);
    expect(restoreFullBackup(raw).drift).toEqual({ weights: {}, days: {} });
  });

  it('keeps the v3 error message wording for a malformed v3 inbox', () => {
    const raw = JSON.stringify({ app: 'shiyu-hanzi-box', formatVersion: 3, inbox: 'nope' });
    expect(() => restoreFullBackup(raw)).toThrow('Invalid v3 backup: inbox is malformed.');
  });

  it('reports v4 in the error message for a malformed v4 inbox', () => {
    const raw = JSON.stringify({ app: 'shiyu-hanzi-box', formatVersion: 4, inbox: 'nope' });
    expect(() => restoreFullBackup(raw)).toThrow('Invalid v4 backup: inbox is malformed.');
  });

  it('normalizes hostile drift values instead of trusting the file', () => {
    const raw = JSON.stringify({
      app: 'shiyu-hanzi-box',
      formatVersion: 4,
      inbox: EMPTY_INBOX,
      drift: { weights: { a: 999 }, days: { nope: 3 } },
    });
    expect(restoreFullBackup(raw).drift).toEqual({ weights: { a: 2 }, days: {} });
  });

  it('leaves drift undefined when the key is absent from a v4 file', () => {
    const raw = JSON.stringify({
      app: 'shiyu-hanzi-box',
      formatVersion: 4,
      inbox: EMPTY_INBOX,
    });
    expect(restoreFullBackup(raw).drift).toBeUndefined();
  });

  it('leaves drift undefined for an inbox-only v2 backup', () => {
    // exportedAt included: parseBackup's readInboxPayload requires it for any
    // envelope-shaped object (app/formatVersion/exportedAt + inbox present) —
    // pre-existing, unrelated to drift, and out of scope for this task.
    const raw = JSON.stringify({
      app: 'shiyu-hanzi-box',
      formatVersion: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      inbox: EMPTY_INBOX,
    });
    expect(restoreFullBackup(raw).drift).toBeUndefined();
  });
});
