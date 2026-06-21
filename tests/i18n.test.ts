import { describe, expect, it } from 'vitest';
import { t } from '../lib/i18n';

describe('i18n messages', () => {
  it('returns English settings labels', () => {
    expect(t('en', 'settings.title')).toBe('Settings');
    expect(t('en', 'dictionary.kaikki')).toBe('Kaikki extension dictionary');
  });

  it('returns zh-CN settings labels', () => {
    expect(t('zh-CN', 'settings.title')).toBe('设置');
    expect(t('zh-CN', 'dictionary.kaikki')).toBe('Kaikki 扩展词典');
  });

  it('falls back to the key when a message is missing', () => {
    expect(t('en', 'missing.key' as never)).toBe('missing.key');
  });
});
