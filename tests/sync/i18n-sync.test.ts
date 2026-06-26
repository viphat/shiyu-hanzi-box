import { describe, expect, it } from 'vitest';
import { messages } from '../../lib/i18n';

const KEYS = [
  'sync.section.title',
  'sync.status.disabled',
  'sync.status.synced',
  'sync.status.syncing',
  'sync.status.pending',
  'sync.status.needsAttention',
  'sync.action.createVault',
  'sync.action.joinVault',
  'sync.action.syncNow',
  'sync.action.reauthorize',
  'sync.action.forgetKey',
  'sync.action.disconnect',
  'sync.warn.passphraseUnrecoverable',
  'sync.warn.includesApiKey',
  'sync.warn.localProfileSecurity',
  'sync.warn.eventualConsistency',
  'sync.warn.joinReplacesSettings',
  'sync.unsupported',
];

describe('sync i18n coverage', () => {
  it('defines every sync key in en and zh-CN', () => {
    for (const key of KEYS) {
      expect(messages.en[key as keyof typeof messages.en], `en missing ${key}`).toBeTruthy();
      expect(messages['zh-CN'][key as keyof typeof messages['zh-CN']], `zh-CN missing ${key}`).toBeTruthy();
    }
  });
});
