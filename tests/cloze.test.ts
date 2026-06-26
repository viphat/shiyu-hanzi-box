import { describe, expect, it } from 'vitest';
import { clozesOverlap, normalizeClozes, suggestClozes } from '../lib/cloze';
import type { Cloze, WordEntry } from '../lib/types';

function word(text: string, overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: `w-${text}`, kind: 'word', text, normalized: text, note: '',
    status: 'inbox', createdAt: 0, updatedAt: 0, occurrences: [], ...overrides,
  };
}

describe('suggestClozes', () => {
  it('returns [] when no saved word matches', () => {
    expect(suggestClozes('他走了。', [word('开心')])).toEqual([]);
  });

  it('maps a match back to raw text offsets', () => {
    const text = '他义无反顾地走了。';
    const [c] = suggestClozes(text, [word('义无反顾')]);
    expect(text.slice(c.start, c.end)).toBe('义无反顾');
    expect(c.wordId).toBe('w-义无反顾');
    expect(c.hint).toBe('none');
  });

  it('projects across stripped whitespace and fullwidth chars', () => {
    const text = '他 说 ＡＢＣ 很好';      // spaces + fullwidth ABC
    const [c] = suggestClozes(text, [word('abc', { normalized: 'abc' })]);
    expect(text.slice(c.start, c.end)).toBe('ＡＢＣ');
  });

  it('prefers the longest non-overlapping match, left to right', () => {
    const text = '学而时习之';
    const out = suggestClozes(text, [word('学'), word('学而时习之')]);
    expect(out).toHaveLength(1);
    expect(text.slice(out[0].start, out[0].end)).toBe('学而时习之');
  });
});

// ---------------------------------------------------------------------------
// clozesOverlap
// ---------------------------------------------------------------------------

describe('clozesOverlap', () => {
  it('returns true for overlapping spans', () => {
    expect(clozesOverlap({ start: 0, end: 3 }, { start: 2, end: 5 })).toBe(true);
    expect(clozesOverlap({ start: 2, end: 5 }, { start: 0, end: 3 })).toBe(true);
  });

  it('returns true when one span contains the other', () => {
    expect(clozesOverlap({ start: 0, end: 5 }, { start: 1, end: 3 })).toBe(true);
    expect(clozesOverlap({ start: 1, end: 3 }, { start: 0, end: 5 })).toBe(true);
  });

  it('returns false for adjacent spans (touching but not overlapping)', () => {
    expect(clozesOverlap({ start: 0, end: 2 }, { start: 2, end: 4 })).toBe(false);
    expect(clozesOverlap({ start: 2, end: 4 }, { start: 0, end: 2 })).toBe(false);
  });

  it('returns false for non-overlapping spans with gap', () => {
    expect(clozesOverlap({ start: 0, end: 2 }, { start: 3, end: 5 })).toBe(false);
    expect(clozesOverlap({ start: 3, end: 5 }, { start: 0, end: 2 })).toBe(false);
  });

  it('returns true for identical spans', () => {
    expect(clozesOverlap({ start: 1, end: 3 }, { start: 1, end: 3 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeClozes
// ---------------------------------------------------------------------------

describe('normalizeClozes', () => {
  function cloze(id: string, start: number, end: number): Cloze {
    return { id, start, end, hint: 'none' };
  }

  it('drops spans with start < 0', () => {
    const result = normalizeClozes([cloze('c1', -1, 2)], 5);
    expect(result).toHaveLength(0);
  });

  it('drops spans with end > textLength', () => {
    const result = normalizeClozes([cloze('c1', 2, 6)], 5);
    expect(result).toHaveLength(0);
  });

  it('drops spans with start >= end (empty or inverted)', () => {
    expect(normalizeClozes([cloze('c1', 2, 2)], 5)).toHaveLength(0);
    expect(normalizeClozes([cloze('c1', 3, 1)], 5)).toHaveLength(0);
  });

  it('keeps valid spans', () => {
    const result = normalizeClozes([cloze('c1', 0, 2), cloze('c2', 3, 5)], 5);
    expect(result).toHaveLength(2);
  });

  it('sorts spans by start position', () => {
    const result = normalizeClozes([cloze('c2', 3, 5), cloze('c1', 0, 2)], 5);
    expect(result[0].id).toBe('c1');
    expect(result[1].id).toBe('c2');
  });

  it('drops overlapping spans (keeps the earlier one)', () => {
    // c1 at 0-3, c2 at 2-5 — they overlap; c1 is earlier so c2 is dropped
    const result = normalizeClozes([cloze('c1', 0, 3), cloze('c2', 2, 5)], 5);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('returns empty for empty input', () => {
    expect(normalizeClozes([], 10)).toHaveLength(0);
  });
});
