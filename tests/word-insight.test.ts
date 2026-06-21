import { describe, expect, it } from 'vitest';
import { buildIndex, materializeEntries } from '../lib/dictionary';
import { buildHighlightedExamples, computeWordInsight } from '../lib/word-insight';
import type { CompactDictionaryAsset, DictionaryIndex, Occurrence, WordEntry } from '../lib/types';

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

  it('keeps the longest range when variant highlights overlap', () => {
    const ex = buildHighlightedExamples('中国人', [
      occ({ surrounding: '中国人', capturedAt: 1 }),
    ], ['中国']);
    expect(ex[0].ranges).toHaveLength(1);
    expect(ex[0].ranges[0].text).toBe('中国人');
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

const asset: CompactDictionaryAsset = {
  meta: {
    source: 'CC-CEDICT',
    sourceUrl: '',
    release: '2026-06-20',
    license: 'CC-BY-SA 4.0',
    licenseUrl: '',
    hash: 'abc123',
    generatedAt: '2026-06-20T00:00:00.000Z',
  },
  columns: {
    simplified: ['你好', '行', '行', '龙'],
    traditional: ['你好', '行', '行', '龍'],
    pinyin: ['ni3 hao3', 'xing2', 'hang2', 'long2'],
    definitionRanges: [
      [0, 2],
      [2, 1],
      [3, 1],
      [4, 1],
    ],
    definitions: ['hello', 'good day', 'to walk', 'row', 'dragon'],
  },
};

const index: DictionaryIndex = buildIndex(materializeEntries(asset));

const word = (over: Partial<WordEntry>): WordEntry => ({
  id: 'w1',
  kind: 'word',
  text: '你好',
  normalized: '你好',
  note: '',
  status: 'inbox',
  createdAt: 1,
  updatedAt: 1,
  occurrences: [],
  ...over,
});

describe('computeWordInsight', () => {
  it('returns ready with exact entries, tone chips, examples, and links', () => {
    const w = word({
      text: '你好',
      occurrences: [
        {
          sourceTitle: 'A',
          sourceUrl: 'https://a.com',
          sourceDomain: 'a.com',
          surrounding: '今天 我 看到 你好 世界',
          capturedAt: 1,
        },
      ],
    });
    const insight = computeWordInsight(w, index);
    expect(insight.status).toBe('ready');
    expect(insight.displayText).toBe('你好');
    expect(insight.exactEntries).toHaveLength(1);
    expect(insight.exactEntries[0].pinyin).toBe('ni3 hao3');
    expect(insight.toneChips).toHaveLength(2);
    expect(insight.toneChips[0].source).toBe('dictionary');
    expect(insight.examples).toHaveLength(1);
    expect(insight.externalLinks.map((l) => l.label)).toEqual(['MDBG', '百度汉语']);
  });

  it('tries the normalized key when captured text is decorated', () => {
    const w = word({ text: '你好！', normalized: '你好' });
    const insight = computeWordInsight(w, index);
    expect(insight.status).toBe('ready');
    expect(insight.exactEntries[0].simplified).toBe('你好');
  });

  it('uses pinyin-pro tone chips when no exact match exists', () => {
    const w = word({ text: '不存在词', normalized: '不存在词' });
    const insight = computeWordInsight(w, index);
    expect(insight.status).toBe('no-definition');
    expect(insight.exactEntries).toEqual([]);
    expect(insight.toneChips[0].source).toBe('pinyin-pro');
  });

  it('runs component fallback for a multi-char word with no exact match', () => {
    const w = word({ text: '龙龙', normalized: '龙龙' });
    const insight = computeWordInsight(w, index);
    expect(insight.status).toBe('no-definition');
    expect(insight.componentEntries.map((e) => e.simplified)).toEqual(['龙', '龙']);
  });

  it('returns dictionary-unavailable status when index is null', () => {
    const w = word({ text: '你好' });
    const insight = computeWordInsight(w, null);
    expect(insight.status).toBe('dictionary-unavailable');
    expect(insight.exactEntries).toEqual([]);
    expect(insight.toneChips[0].source).toBe('pinyin-pro');
  });

  it('caps exact entries to five', () => {
    const many = buildIndex(
      Array.from({ length: 8 }, (_, i) => ({
        index: i,
        traditional: '行',
        simplified: '行',
        pinyin: `pinyin${i}`,
        definitions: [`d${i}`],
      })),
    );
    const w = word({ text: '行' });
    const insight = computeWordInsight(w, many);
    expect(insight.exactEntries.length).toBeLessThanOrEqual(5);
  });
});
