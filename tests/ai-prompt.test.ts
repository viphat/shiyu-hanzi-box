import { describe, expect, it } from 'vitest';
import { buildMessages } from '../lib/ai/prompt';
import type { DictionaryEntry, WordEntry } from '../lib/types';

const word: WordEntry = {
  id: 'w1',
  kind: 'word',
  text: '行',
  normalized: '行',
  note: '',
  status: 'inbox',
  createdAt: 1,
  updatedAt: 1,
  occurrences: [
    {
      sourceTitle: 'Test',
      sourceUrl: 'https://test.com',
      sourceDomain: 'test.com',
      surrounding: '你今天出行很方便',
      capturedAt: 1,
    },
  ],
};

const cedictEntries: DictionaryEntry[] = [
  {
    index: 0,
    traditional: '行',
    simplified: '行',
    pinyin: 'xing2',
    definitions: ['to walk', 'to travel'],
  },
  {
    index: 1,
    traditional: '行',
    simplified: '行',
    pinyin: 'hang2',
    definitions: ['row', 'line'],
  },
];

describe('buildMessages', () => {
  it('returns a system message and a user message', () => {
    const messages = buildMessages(word, undefined, [], undefined);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('the system message requests JSON output and lists fields', () => {
    const messages = buildMessages(word, undefined, [], undefined);
    const system = messages[0].content;

    expect(system).toContain('summary');
    expect(system).toContain('sampleSentences');
    expect(system).toContain('translations');
    expect(system).toContain('register');
    expect(system).toContain('json');
  });

  it('includes an example JSON object for providers that require JSON-mode guidance', () => {
    const messages = buildMessages(word, undefined, [], undefined);
    const system = messages[0].content;

    expect(system).toContain('Example JSON output');
    expect(system).toContain('"definitions":');
    expect(system).toContain('"collocations":');
  });

  it('the user message contains the word text', () => {
    const messages = buildMessages(word, undefined, [], undefined);
    const user = messages[1].content;

    expect(user).toContain('行');
  });

  it('includes pinyin when provided', () => {
    const messages = buildMessages(word, 'xíng', [], undefined);
    const user = messages[1].content;

    expect(user).toContain('xíng');
  });

  it('includes CEDICT glosses when provided', () => {
    const messages = buildMessages(word, undefined, cedictEntries, undefined);
    const user = messages[1].content;

    expect(user).toContain('xing2');
    expect(user).toContain('to walk');
    expect(user).toContain('hang2');
    expect(user).toContain('row');
  });

  it('includes a recent occurrence when provided', () => {
    const messages = buildMessages(word, undefined, [], word.occurrences[0]);
    const user = messages[1].content;

    expect(user).toContain('出行');
  });

  it('is deterministic: same inputs produce same output', () => {
    const a = buildMessages(word, 'xíng', cedictEntries, word.occurrences[0]);
    const b = buildMessages(word, 'xíng', cedictEntries, word.occurrences[0]);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
