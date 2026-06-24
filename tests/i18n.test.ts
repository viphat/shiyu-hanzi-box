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

  it('returns study tool labels in both locales', () => {
    expect(t('en', 'pinyin.generate')).toBe('Pinyin');
    expect(t('en', 'tts.speak')).toBe('Pronounce');
    expect(t('en', 'traditional.generate')).toBe('Traditional');
    expect(t('en', 'traditional.show')).toBe('Show Traditional');
    expect(t('en', 'traditional.hide')).toBe('Hide Traditional');
    expect(t('zh-CN', 'pinyin.generate')).toBe('注音');
    expect(t('zh-CN', 'tts.speak')).toBe('发音');
    expect(t('zh-CN', 'traditional.generate')).toBe('繁體');
    expect(t('zh-CN', 'traditional.show')).toBe('显示繁體');
    expect(t('zh-CN', 'traditional.hide')).toBe('隐藏繁體');
  });

  it('returns popup dashboard labels in both locales', () => {
    expect(t('en', 'popup.openDashboard')).toBe('Open dashboard');
    expect(t('zh-CN', 'popup.openDashboard')).toBe('打开收藏箱');
  });

  it('formats messages with named values', () => {
    expect(formatMessage('en', 'toolbar.restoreSuccess', { count: 3 })).toBe('Restored 3 entries from backup.');
    expect(formatMessage('zh-CN', 'toolbar.restoreConfirm', { count: 3, name: 'notes.json' })).toBe(
      '要从「notes.json」还原 3 条记录吗？这会替换当前本地收藏箱。',
    );
  });

  it('returns SRS analytics labels in both locales', () => {
    expect(t('en', 'srs.dueNow')).toBe('Due now');
    expect(t('en', 'srs.dueLaterToday')).toBe('Later today');
    expect(t('en', 'srs.newAvailableToday')).toBe('New today');
    expect(t('en', 'srs.reviewedToday')).toBe('Reviewed today');
    expect(t('en', 'srs.retention')).toBe('Retention');
    expect(t('zh-CN', 'srs.dueNow')).toBe('现在到期');
    expect(t('zh-CN', 'srs.retention')).toBe('记忆率');
  });

  it('returns SRS settings labels in both locales', () => {
    expect(t('en', 'settings.srs')).toBe('Spaced repetition');
    expect(t('en', 'settings.srsDesiredRetention')).toBe(
      'Target retention',
    );
    expect(t('en', 'settings.srsMaxInterval')).toBe(
      'Maximum interval (days)',
    );
    expect(t('en', 'settings.srsNewPerDay')).toBe('New cards per day');
    expect(t('zh-CN', 'settings.srs')).toBe('间隔复习');
    expect(t('zh-CN', 'settings.srsDesiredRetention')).toBe(
      '目标记忆率',
    );
    expect(t('zh-CN', 'settings.srsMaxInterval')).toBe(
      '最大间隔（天）',
    );
    expect(t('zh-CN', 'settings.srsNewPerDay')).toBe('每日新卡片数');
  });

  it('formats the remaining review-card count in both locales', () => {
    expect(formatMessage('en', 'review.remaining', { count: 12 })).toBe(
      '12 remaining',
    );
    expect(
      formatMessage('zh-CN', 'review.remaining', { count: 12 }),
    ).toBe('剩余 12 张');
  });
});
