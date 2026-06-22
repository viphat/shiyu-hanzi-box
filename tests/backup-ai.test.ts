import { describe, expect, it } from 'vitest';
import { parseBackup, serializeBackup } from '../lib/backup';
import type { Inbox, WordEntry } from '../lib/types';

const word: WordEntry = {
  id: 'w1',
  kind: 'word',
  text: '你好',
  normalized: '你好',
  note: '',
  status: 'inbox',
  createdAt: 1,
  updatedAt: 1,
  occurrences: [],
  aiInsight: {
    provider: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    generatedAt: 1,
    summary: 'hello',
    register: 'neutral',
    definitions: ['打招呼 - hello'],
    sampleSentences: ['你好。'],
    translations: ['Hello.'],
    collocations: [],
    notes: '',
  },
};

describe('backup round-trip with aiInsight', () => {
  it('preserves aiInsight through serialize/parse', () => {
    const inbox: Inbox = { words: [word], quotes: [] };
    const restored = parseBackup(serializeBackup(inbox));

    expect(restored.words).toHaveLength(1);
    expect(restored.words[0].aiInsight).toBeDefined();
    expect(restored.words[0].aiInsight!.summary).toBe('hello');
  });

  it('parses old backups without aiInsight without error', () => {
    const { aiInsight: _aiInsight, ...oldWord } = word;
    const inbox: Inbox = { words: [oldWord], quotes: [] };
    const restored = parseBackup(serializeBackup(inbox));

    expect(restored.words[0].aiInsight).toBeUndefined();
  });
});
