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

  it('returns cloze and parked-quote labels in both locales', () => {
    expect(t('en', 'cloze.addBlank')).toBe('Add a blank to review');
    expect(t('zh-CN', 'cloze.addBlank')).toBe('添加填空以复习');
    expect(t('en', 'cloze.parked')).toBe('Parked — no blank');
    expect(t('zh-CN', 'cloze.parked')).toBe('待添加填空');
    expect(t('en', 'cloze.removeBlank')).toBe('Remove blank');
    expect(t('zh-CN', 'cloze.removeBlank')).toBe('移除填空');
    expect(t('en', 'cloze.hintNone')).toBe('Hint: none');
    expect(t('zh-CN', 'cloze.hintNone')).toBe('提示：无');
    expect(t('en', 'cloze.hintPinyin')).toBe('Hint: pinyin');
    expect(t('zh-CN', 'cloze.hintPinyin')).toBe('提示：拼音');
    expect(t('en', 'cloze.hintLength')).toBe('Hint: length');
    expect(t('zh-CN', 'cloze.hintLength')).toBe('提示：字数');
    expect(t('en', 'cloze.blankAria')).toBe('hidden answer');
    expect(t('zh-CN', 'cloze.blankAria')).toBe('隐藏的答案');
    expect(t('en', 'review.answer')).toBe('Answer');
    expect(t('zh-CN', 'review.answer')).toBe('答案');
  });

  it('formats cloze.parkedCount with count interpolation in both locales', () => {
    expect(formatMessage('en', 'cloze.parkedCount', { count: 5 })).toBe('5 parked');
    expect(formatMessage('zh-CN', 'cloze.parkedCount', { count: 5 })).toBe('5 条待填空');
  });

  it('returns new cloze authoring labels in both locales', () => {
    expect(t('en', 'cloze.markBlanks')).toBe('Mark blanks');
    expect(t('en', 'cloze.applyMarks')).toBe('Apply');
    expect(t('en', 'cloze.aiSuggest')).toBe('Suggest blanks');
    expect(t('en', 'cloze.aiNoSuggestions')).toBe('No usable blank suggestions.');
    expect(t('zh-CN', 'cloze.markBlanks')).toBe('手动填空');
    expect(t('zh-CN', 'cloze.applyMarks')).toBe('应用');
    expect(t('zh-CN', 'cloze.aiSuggest')).toBe('建议填空');
    expect(t('zh-CN', 'cloze.aiNoSuggestions')).toBe('没有可用的填空建议。');
  });
});
