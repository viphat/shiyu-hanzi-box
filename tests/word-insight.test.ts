import { describe, expect, it } from 'vitest';
import { buildHighlightedExamples } from '../lib/word-insight';
import type { Occurrence } from '../lib/types';

const occ = (over: Partial<Occurrence>): Occurrence => ({
  sourceTitle: 'T',
  sourceUrl: 'https://t.com/1',
  sourceDomain: 't.com',
  surrounding: '',
  capturedAt: 1,
  ...over,
});

describe('buildHighlightedExamples', () => {
  it('highlights the captured word inside surrounding text', () => {
    const ex = buildHighlightedExamples('你好', [
      occ({ surrounding: '今天 我 看到 你好 世界 这句', capturedAt: 1 }),
    ]);
    expect(ex).toHaveLength(1);
    expect(ex[0].ranges).toHaveLength(1);
    expect(ex[0].ranges[0].text).toBe('你好');
    expect(ex[0].snippet).toContain('你好');
  });

  it('highlights all occurrences of the word in the snippet', () => {
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: '龙 和 龙 是 不同的 龙', capturedAt: 1 }),
    ]);
    expect(ex[0].ranges.length).toBe(3);
  });

  it('dedupes identical surrounding sentences keeping the newest', () => {
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: '同 一 句 龙', capturedAt: 1 }),
      occ({ surrounding: '同 一 句 龙', capturedAt: 5 }),
      occ({ surrounding: '同 一 句 龙', capturedAt: 3 }),
    ]);
    expect(ex).toHaveLength(1);
    expect(ex[0].capturedAt).toBe(5);
  });

  it('caps to the newest three examples', () => {
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: 'a 龙', capturedAt: 1 }),
      occ({ surrounding: 'b 龙', capturedAt: 2 }),
      occ({ surrounding: 'c 龙', capturedAt: 3 }),
      occ({ surrounding: 'd 龙', capturedAt: 4 }),
      occ({ surrounding: 'e 龙', capturedAt: 5 }),
    ]);
    expect(ex).toHaveLength(3);
    expect(ex.map((e) => e.capturedAt)).toEqual([5, 4, 3]);
  });

  it('returns an example without ranges when surrounding is empty', () => {
    const ex = buildHighlightedExamples('龙', [occ({ surrounding: '' })]);
    expect(ex).toHaveLength(1);
    expect(ex[0].ranges).toEqual([]);
    expect(ex[0].snippet).toBe('');
  });

  it('clips surrounding to the first 1000 characters before scanning', () => {
    const long = 'x'.repeat(1200);
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: long + '龙', capturedAt: 1 }),
    ]);
    expect(ex[0].ranges).toEqual([]);
  });

  it('renders snippet without a highlight when the word is not found', () => {
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: '这里 没有 那个 字', capturedAt: 1 }),
    ]);
    expect(ex[0].ranges).toEqual([]);
    expect(ex[0].snippet).toContain('这里');
  });

  it('falls back to simplified/traditional variants when captured form is absent', () => {
    const ex = buildHighlightedExamples('龍', [
      occ({ surrounding: '这里 出现 的 是 龙', capturedAt: 1 }),
    ], ['龙']);
    expect(ex[0].ranges).toHaveLength(1);
    expect(ex[0].ranges[0].text).toBe('龙');
  });

  it('clips long surrounding text to a compact snippet around the match', () => {
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: `${'前'.repeat(200)}龙${'后'.repeat(200)}`, capturedAt: 1 }),
    ]);
    expect(ex[0].snippet.length).toBeLessThan(180);
    expect(ex[0].snippet).toContain('龙');
    expect(ex[0].ranges[0].text).toBe('龙');
  });
});
