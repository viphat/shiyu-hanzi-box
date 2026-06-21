import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseCedictLine,
  parseCedictText,
  extractRelease,
} from '../lib/dictionary';

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
