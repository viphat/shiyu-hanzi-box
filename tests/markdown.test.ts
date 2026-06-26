import { describe, expect, it } from 'vitest';
import { buildIndex } from '../lib/dictionary';
import { renderDay } from '../lib/markdown';
import type { AiInsight, DictionaryEntry, QuoteEntry, WordEntry } from '../lib/types';

const day = '2026-06-20';

const word: WordEntry = {
  id: 'w1',
  kind: 'word',
  text: '你好',
  normalized: '你好',
  note: 'common hello',
  status: 'inbox',
  createdAt: 1,
  updatedAt: 1,
  occurrences: [
    { sourceTitle: 'A', sourceUrl: 'https://a.com/1', sourceDomain: 'a.com', surrounding: 's1', capturedAt: 1 },
    { sourceTitle: 'B', sourceUrl: 'https://b.com/2', sourceDomain: 'b.com', surrounding: 's2', capturedAt: 2 },
  ],
  pinyin: 'nǐ hǎo',
};

const quote: QuoteEntry = {
  id: 'q1',
  kind: 'quote',
  text: '学而时习之',
  category: '论语',
  tags: [],
  note: '',
  status: 'inbox',
  createdAt: 1,
  updatedAt: 1,
  sourceTitle: 'Lunyu',
  sourceUrl: 'https://lunyu.com',
  sourceDomain: 'lunyu.com',
  surrounding: '不亦说乎',
};

describe('renderDay', () => {
  it('produces frontmatter with the date', () => {
    const md = renderDay(day, [word], []);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('date: 2026-06-20');
  });

  it('lists a word once with all source links and a review checkbox', () => {
    const legacyWord = { ...word, tags: ['greeting'] } as unknown as WordEntry;
    const md = renderDay(day, [legacyWord], []);
    expect(md).toContain('## Words');
    expect(md).toContain('- [ ] **你好**');
    expect(md).toContain('https://a.com/1');
    expect(md).toContain('https://b.com/2');
    expect(md).toContain('nǐ hǎo');
    expect(md).not.toContain('#greeting');
  });

  it('lists each quote as its own entry', () => {
    const md = renderDay(day, [], [quote]);
    expect(md).toContain('## Quotes');
    expect(md).toContain('学而时习之');
    expect(md).toContain('论语');
    expect(md).toContain('https://lunyu.com');
  });

  it('omits empty sections', () => {
    const md = renderDay(day, [], []);
    expect(md).not.toContain('## Words');
    expect(md).not.toContain('## Quotes');
  });

  it('adds a concise SRS review line when review state exists', () => {
    const reviewedWord: WordEntry = {
      ...word,
      review: {
        scheduler: 'fsrs-v1',
        dueAt: Date.UTC(2026, 6, 25),
        intervalDays: 3,
        repetitions: 2,
        lapses: 0,
        cardState: 'review',
        stability: 3,
        difficulty: 5,
        lastReviewedAt: Date.UTC(2026, 5, 20),
      },
    };
    const md = renderDay('2026-06-20', [reviewedWord], []);
    expect(md).toContain('Review:');
    expect(md).toContain('state review');
    expect(md).toContain('interval 3 days');
    expect(md).not.toContain('stability');
  });
});

const dictEntries: DictionaryEntry[] = [
  { index: 0, traditional: '你好', simplified: '你好', pinyin: 'ni3 hao3', definitions: ['hello', 'good day'] },
];

describe('renderDay with dictionary', () => {
  it('includes a Dictionary subsection when an index is provided', () => {
    const index = buildIndex(dictEntries);
    const md = renderDay(day, [word], [], index);
    expect(md).toContain('**你好**');
    expect(md).toContain('hello');
    expect(md).toContain('good day');
    expect(md).toContain('ni3 hao3');
  });

  it('omits the Dictionary subsection when no index is provided', () => {
    const md = renderDay(day, [word], []);
    expect(md).not.toContain('  - Dictionary:');
  });

  it('omits the subsection when the word has no dictionary match', () => {
    const index = buildIndex(dictEntries);
    const unmatched: WordEntry = { ...word, text: '不存在', normalized: '不存在' };
    const md = renderDay(day, [unmatched], [], index);
    expect(md).toContain('**不存在**');
    expect(md).not.toContain('  - Dictionary:');
  });

  it('uses the normalized key when exported word text has punctuation', () => {
    const index = buildIndex(dictEntries);
    const decorated: WordEntry = { ...word, text: '你好！', normalized: '你好' };
    const md = renderDay(day, [decorated], [], index);
    expect(md).toContain('Dictionary: _ni3 hao3_ hello; good day');
  });
});

const aiInsight: AiInsight = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com/v1',
  generatedAt: 1,
  summary: 'hello greeting',
  register: 'neutral',
  definitions: ['打招呼 - hello'],
  sampleSentences: ['你好世界。'],
  translations: ['Hello world.'],
  collocations: ['你好吗'],
  notes: 'Common greeting.',
};

describe('renderDay with clozes', () => {
  it('renders clozes as numbered {{cN::...}} in document order (sorts by start)', () => {
    const quoteWithClozes: typeof quote = {
      ...quote,
      text: '他义无反顾地走了',
      // Intentionally unsorted: id 'b' at [6,7) comes first in array
      clozes: [
        { id: 'b', start: 6, end: 7 },
        { id: 'a', start: 1, end: 5 },
      ],
    };
    const md = renderDay(day, [], [quoteWithClozes]);
    expect(md).toContain('- [ ] > 他{{c1::义无反顾}}地{{c2::走}}了');
  });

  it('renders a clozeless quote as plain text (unchanged)', () => {
    const md = renderDay(day, [], [quote]);
    expect(md).toContain(`- [ ] > ${quote.text}`);
    expect(md).not.toContain('{{');
  });
});

describe('renderDay with AI insight', () => {
  it('includes an AI Insight subsection when the word has aiInsight', () => {
    const md = renderDay(day, [{ ...word, aiInsight }], []);

    expect(md).toContain('## AI Insight');
    expect(md).toContain('hello greeting');
    expect(md).toContain('你好世界。');
    expect(md).toContain('Hello world.');
  });

  it('omits the AI Insight subsection when aiInsight is absent', () => {
    const md = renderDay(day, [word], []);

    expect(md).not.toContain('AI Insight');
  });
});
