import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { buildWordInsightMessages } from '../lib/ai/prompt';
import { parseAiResponse } from '../lib/ai/parse';
import { applyWordAiInsight } from '../lib/sync/mutations';
import { getInbox, setInbox } from '../lib/storage';
import type {
  AiInsight,
  DictionaryEntry,
  VietnameseAiInsight,
  WordEntry,
} from '../lib/types';

const word: WordEntry = {
  id: 'w1',
  kind: 'word',
  text: '你好',
  normalized: '你好',
  note: '',
  status: 'inbox',
  createdAt: 1,
  updatedAt: 10,
  occurrences: [],
};

const englishInsight: AiInsight = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com',
  generatedAt: 100,
  summary: 'hello',
  register: 'neutral',
  definitions: ['问候 - hello'],
  sampleSentences: ['你好。'],
  translations: ['Hello.'],
  collocations: ['你好吗'],
  notes: 'A common greeting.',
};

const vietnameseInsight: VietnameseAiInsight = {
  ...englishInsight,
  generatedAt: 200,
  summary: 'xin chào',
  definitions: ['lời chào hỏi'],
  translations: ['Xin chào.'],
  notes: 'Lời chào thông dụng.',
  outputLanguage: 'vi',
};

const cvdictEntry: DictionaryEntry = {
  index: 0,
  traditional: '你好',
  simplified: '你好',
  pinyin: 'ni3 hao3',
  definitions: ['xin chào'],
  source: 'cvdict',
};

describe('Vietnamese AI word insight', () => {
  beforeEach(() => fakeBrowser.reset());

  it('uses Vietnamese instructions and CVDICT grounding only for AI VI', () => {
    const messages = buildWordInsightMessages({
      word,
      language: 'vi',
      pinyin: 'ni3 hao3',
      englishEntries: [
        { ...cvdictEntry, definitions: ['hello'], source: 'cc-cedict' },
      ],
      vietnameseEntries: [cvdictEntry],
      recentOccurrence: undefined,
    });

    expect(messages[0].content).toContain('Vietnamese');
    expect(messages[1].content).toContain('xin chào');
    expect(messages[1].content).not.toContain('hello');
    expect(messages[1].content).not.toContain('CEDICT entries');
  });

  it('marks only Vietnamese parser output with its output language', () => {
    const body = JSON.stringify({
      summary: 'xin chào',
      register: 'neutral',
      definitions: ['lời chào hỏi'],
      sampleSentences: ['你好。'],
      translations: ['Xin chào.'],
      collocations: ['你好吗'],
      notes: 'Lời chào thông dụng.',
    });

    const vietnamese = parseAiResponse(
      body,
      'deepseek',
      'deepseek-chat',
      'https://api.deepseek.com',
      'vi',
    );
    const english = parseAiResponse(
      body,
      'deepseek',
      'deepseek-chat',
      'https://api.deepseek.com',
      'en',
    );

    expect(vietnamese.ok && vietnamese.value.outputLanguage).toBe('vi');
    expect(english.ok && 'outputLanguage' in english.value).toBe(false);
  });

  it('patches Vietnamese output without replacing English output', async () => {
    await setInbox({ words: [{ ...word, aiInsight: englishInsight }], quotes: [] });

    await applyWordAiInsight({
      wordId: 'w1',
      language: 'vi',
      insight: vietnameseInsight,
    });

    expect((await getInbox()).words[0]).toMatchObject({
      aiInsight: englishInsight,
      aiVietnameseInsight: vietnameseInsight,
    });
  });

  it('rejects a patch for an unknown word without changing the inbox', async () => {
    const inbox = { words: [{ ...word, aiInsight: englishInsight }], quotes: [] };
    await setInbox(inbox);

    await expect(
      applyWordAiInsight({
        wordId: 'missing',
        language: 'vi',
        insight: vietnameseInsight,
      }),
    ).rejects.toThrow('Unknown word');
    expect(await getInbox()).toEqual(inbox);
  });
});
