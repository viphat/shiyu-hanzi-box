import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  parseCedictLine,
  parseCedictText,
  extractRelease,
  lookupExact,
  segmentComponents,
} from '../lib/dictionary';
import type { DictionaryEntry } from '../lib/types';

const sample = readFileSync(
  join(import.meta.dirname, 'fixtures/cedict-sample.txt'),
  'utf8',
);

describe('parseCedictLine', () => {
  it('parses a normal entry', () => {
    const entry = parseCedictLine('你好 你好 [ni3 hao3] /hello/good day/');
    expect(entry).not.toBeNull();
    expect(entry!.traditional).toBe('你好');
    expect(entry!.simplified).toBe('你好');
    expect(entry!.pinyin).toBe('ni3 hao3');
    expect(entry!.definitions).toEqual(['hello', 'good day']);
  });

  it('returns null for comment lines', () => {
    expect(parseCedictLine('# comment')).toBeNull();
  });

  it('returns null for blank lines', () => {
    expect(parseCedictLine('')).toBeNull();
    expect(parseCedictLine('   ')).toBeNull();
  });

  it('returns null for malformed lines', () => {
    expect(parseCedictLine('INVALID LINE WITHOUT BRACKETS')).toBeNull();
    expect(parseCedictLine('a b not brackets /only defs/')).toBeNull();
  });

  it('preserves bracketed text inside definitions', () => {
    const entry = parseCedictLine(
      '亂 乱 [luan4] /random text with [brackets] inside/',
    );
    expect(entry!.definitions).toEqual(['random text with [brackets] inside']);
  });

  it('drops the trailing empty definition from a trailing slash', () => {
    const entry = parseCedictLine('中國 中国 [zhong1 guo2] /China/Middle Kingdom/');
    expect(entry!.definitions).toEqual(['China', 'Middle Kingdom']);
  });
});

describe('parseCedictText', () => {
  it('skips comments and invalid lines, returns parsed entries', () => {
    const entries = parseCedictText(sample);
    expect(entries).toHaveLength(6);
    expect(entries[0].simplified).toBe('你好');
  });

  it('records skipped line count via the with-stats variant', () => {
    const { entries, skipped } = parseCedictText(sample, { withStats: true });
    expect(entries).toHaveLength(6);
    expect(skipped).toBe(1);
  });
});

describe('extractRelease', () => {
  it('reads the release from the #! date marker line', () => {
    expect(extractRelease(sample)).toBe('2026-06-20');
  });

  it('returns "unknown" when no marker is present', () => {
    expect(extractRelease('# just a comment\n你好 你好 [ni3 hao3] /hi/')).toBe(
      'unknown',
    );
  });
});

const sampleEntries: DictionaryEntry[] = [
  { index: 0, traditional: '你好', simplified: '你好', pinyin: 'ni3 hao3', definitions: ['hello', 'good day'] },
  { index: 1, traditional: '中國', simplified: '中国', pinyin: 'zhong1 guo2', definitions: ['China'] },
  { index: 2, traditional: '行', simplified: '行', pinyin: 'xing2', definitions: ['to walk'] },
  { index: 3, traditional: '行', simplified: '行', pinyin: 'hang2', definitions: ['row'] },
  { index: 4, traditional: '龍', simplified: '龙', pinyin: 'long2', definitions: ['dragon'] },
];

describe('buildIndex + lookupExact', () => {
  const index = buildIndex(sampleEntries);

  it('finds entries by simplified form', () => {
    const hits = lookupExact(index, '你好');
    expect(hits).toHaveLength(1);
    expect(hits[0].pinyin).toBe('ni3 hao3');
  });

  it('finds entries by traditional form', () => {
    const hits = lookupExact(index, '龍');
    expect(hits).toHaveLength(1);
    expect(hits[0].definitions).toEqual(['dragon']);
  });

  it('returns all entries when simplified maps to multiple (polyphone)', () => {
    const hits = lookupExact(index, '行');
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.pinyin).sort()).toEqual(['hang2', 'xing2']);
  });

  it('returns an empty array when no match', () => {
    expect(lookupExact(index, '不存在的词')).toEqual([]);
  });

  it('normalizes whitespace in lookup keys', () => {
    const hits = lookupExact(index, '中 国');
    expect(hits).toHaveLength(1);
    expect(hits[0].definitions).toEqual(['China']);
  });
});

describe('segmentComponents', () => {
  const idx = buildIndex([
    ...sampleEntries,
    { index: 5, traditional: '雲', simplified: '云', pinyin: 'yun2', definitions: ['cloud'] },
  ]);

  it('returns no segments when the text is an exact match (caller decides)', () => {
    const segs = segmentComponents(idx, '你好');
    expect(segs.map((s) => s.entry?.simplified ?? s.text)).toContain('你好');
  });

  it('segments multi-char text into matched + single-char components', () => {
    const segs = segmentComponents(idx, '龙云');
    const matched = segs.filter((s) => s.entry !== undefined);
    expect(matched.map((s) => s.entry!.simplified).sort()).toEqual(['云', '龙']);
  });

  it('leaves unmatched characters as plain components', () => {
    const segs = segmentComponents(idx, '龙雨');
    expect(segs).toHaveLength(2);
    expect(segs[0].entry?.simplified).toBe('龙');
    expect(segs[1].entry).toBeUndefined();
    expect(segs[1].text).toBe('雨');
  });

  it('prefers longest dictionary match', () => {
    const segs = segmentComponents(idx, '你好龙');
    expect(segs).toHaveLength(2);
    expect(segs[0].entry?.simplified).toBe('你好');
    expect(segs[1].entry?.simplified).toBe('龙');
  });

  it('can choose dictionary entries longer than four characters', () => {
    const longIndex = buildIndex([
      ...sampleEntries,
      {
        index: 6,
        traditional: '中华人民共和国',
        simplified: '中华人民共和国',
        pinyin: 'zhong1 hua2 ren2 min2 gong4 he2 guo2',
        definitions: ['People’s Republic of China'],
      },
    ]);
    const segs = segmentComponents(longIndex, '中华人民共和国龙');
    expect(segs[0].entry?.simplified).toBe('中华人民共和国');
    expect(segs[1].entry?.simplified).toBe('龙');
  });

  it('skips non-Chinese characters without matching them', () => {
    const segs = segmentComponents(idx, '龙abc云');
    const chinese = segs.filter((s) => /[\u4e00-\u9fff]/.test(s.text));
    expect(chinese.map((s) => s.entry?.simplified)).toEqual(['龙', '云']);
  });

  it('returns an empty array for input above the length cap', () => {
    const long = '龙'.repeat(17);
    expect(segmentComponents(idx, long)).toEqual([]);
  });
});
