import { describe, expect, it } from 'vitest';
import { formatMessage, t } from '../lib/i18n';

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

  it('returns Traditional conversion labels in both locales', () => {
    expect(t('en', 'traditional.generate')).toBe('Traditional');
    expect(t('en', 'traditional.show')).toBe('Show Traditional');
    expect(t('en', 'traditional.hide')).toBe('Hide Traditional');
    expect(t('zh-CN', 'traditional.generate')).toBe('繁體');
    expect(t('zh-CN', 'traditional.show')).toBe('显示繁體');
    expect(t('zh-CN', 'traditional.hide')).toBe('隐藏繁體');
  });

  it('formats messages with named values', () => {
    expect(formatMessage('en', 'toolbar.restoreSuccess', { count: 3 })).toBe('Restored 3 entries from backup.');
    expect(formatMessage('zh-CN', 'toolbar.restoreConfirm', { count: 3, name: 'notes.json' })).toBe(
      '要从「notes.json」还原 3 条记录吗？这会替换当前本地收藏箱。',
    );
  });
});
