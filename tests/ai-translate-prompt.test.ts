import { describe, expect, it } from 'vitest';
import { buildTranslateMessages } from '../lib/ai/translate-prompt';

describe('buildTranslateMessages', () => {
  it('returns a system message then a user message', () => {
    const messages = buildTranslateMessages('学而时习之');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('instructs the model to return JSON only in the translation shape', () => {
    const system = buildTranslateMessages('学而时习之')[0].content;
    expect(system).toContain('"translation"');
    expect(system).toContain('JSON');
  });

  it('carries the quote text verbatim in the user message', () => {
    const user = buildTranslateMessages('天地不仁，以万物为刍狗')[1].content;
    expect(user).toContain('天地不仁，以万物为刍狗');
  });

  it('forbids pinyin, commentary, alternatives, and explanation', () => {
    // Load-bearing: without this instruction the model returns glosses and
    // notes, and the quote card has nowhere to put them.
    const system = buildTranslateMessages('学而时习之')[0].content;
    expect(system).toContain('pinyin');
    expect(system).toContain('commentary');
    expect(system).toContain('alternatives');
    expect(system).toContain('explanation');
  });
});
