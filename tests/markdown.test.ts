import { describe, expect, it } from 'vitest';
import { renderDay } from '../lib/markdown';
import type { QuoteEntry, WordEntry } from '../lib/types';

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
});
