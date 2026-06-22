import { describe, expect, it } from 'vitest';
import { t } from '../lib/i18n';

describe('i18n messages', () => {
  it('returns English settings labels', () => {
    expect(t('en', 'settings.title')).toBe('Settings');
    expect(t('en', 'dictionary.kaikki')).toBe('Kaikki extension dictionary');
    expect(t('en', 'settings.kaikkiImportNotice')).toContain('large Kaikki files can take');
    expect(t('en', 'settings.filteredRecords')).toBe('Filtered records');
  });

  it('returns zh-CN settings labels', () => {
    expect(t('zh-CN', 'settings.title')).toBe('设置');
    expect(t('zh-CN', 'dictionary.kaikki')).toBe('Kaikki 扩展词典');
    expect(t('zh-CN', 'settings.kaikkiImportNotice')).toContain('大型 Kaikki 文件');
    expect(t('zh-CN', 'settings.filteredRecords')).toBe('已过滤记录');
  });

  it('falls back to the key when a message is missing', () => {
    expect(t('en', 'missing.key' as never)).toBe('missing.key');
  });
});
