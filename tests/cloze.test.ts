import { describe, expect, it } from 'vitest';
import { clozeFromRange, countParkedQuotes, isParkedQuote, suggestClozes } from '../lib/cloze';
import type { Cloze, QuoteEntry, WordEntry } from '../lib/types';

function makeQuote(overrides: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1', kind: 'quote', text: '学而时习之', tags: [], note: '',
    status: 'inbox', createdAt: 0, updatedAt: 0, category: 'classic',
    sourceTitle: '', sourceUrl: '', sourceDomain: '', surrounding: '',
    ...overrides,
  };
}

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

  it('assigns a wordId when word is provided', () => {
    const text = '学而时习之';
    const [c] = suggestClozes(text, [word('学而', { id: 'w-xueer' })]);
    expect(c.wordId).toBe('w-xueer');
  });

  it('offset map is correct when normalizeText strips leading edge punctuation', () => {
    // 「 (U+300C) and 」 (U+300D) are CJK corner brackets matched by \p{P}.
    // normalizeWithMap strips them from the edges, shifting the map by 1 at
    // the start. The raw indices must still point to the unbracketed characters.
    const text = '「义无反顾」';
    const [c] = suggestClozes(text, [word('义无反顾')]);
    expect(c).toBeDefined();
    expect(text.slice(c.start, c.end)).toBe('义无反顾');
  });
});

// ---------------------------------------------------------------------------
// clozeFromRange
// ---------------------------------------------------------------------------

describe('clozeFromRange', () => {
  const text = '学而时习之';

  it('returns a cloze for a valid non-overlapping range', () => {
    const result = clozeFromRange(text, 0, 2, []);
    expect(result).not.toBeNull();
    expect(result!.start).toBe(0);
    expect(result!.end).toBe(2);
    expect(result!.hint).toBe('none');
    expect(result!.id).toBeTruthy();
  });

  it('normalises reverse selection (end < start)', () => {
    const result = clozeFromRange(text, 3, 1, []);
    expect(result).not.toBeNull();
    expect(result!.start).toBe(1);
    expect(result!.end).toBe(3);
  });

  it('returns null for empty range (start === end)', () => {
    expect(clozeFromRange(text, 2, 2, [])).toBeNull();
  });

  it('returns null for out-of-range end', () => {
    expect(clozeFromRange(text, 0, 99, [])).toBeNull();
  });

  it('returns null for negative start', () => {
    expect(clozeFromRange(text, -1, 2, [])).toBeNull();
  });

  it('returns null when overlapping an existing cloze', () => {
    const existing: Cloze[] = [{ id: 'e1', start: 1, end: 3, hint: 'none' }];
    expect(clozeFromRange(text, 2, 4, existing)).toBeNull();
  });

  it('accepts an adjacent non-overlapping range', () => {
    const existing: Cloze[] = [{ id: 'e1', start: 0, end: 2, hint: 'none' }];
    const result = clozeFromRange(text, 2, 4, existing);
    expect(result).not.toBeNull();
  });

  it('accepts a full-text span covering the whole quote (spec §9)', () => {
    // A cloze that spans the entire quote text is explicitly allowed.
    const result = clozeFromRange(text, 0, text.length, []);
    expect(result).not.toBeNull();
    expect(result!.start).toBe(0);
    expect(result!.end).toBe(text.length);
  });

  it('returns null for a whitespace-only selection', () => {
    // '学 而' -> the single space at index 1 is unreviewable as a blank.
    expect(clozeFromRange('学 而', 1, 2, [])).toBeNull();
  });

  it('returns null for a punctuation-only selection', () => {
    // '学，而' -> the fullwidth comma at index 1 carries no reviewable content.
    expect(clozeFromRange('学，而', 1, 2, [])).toBeNull();
  });

  it('accepts a span that includes at least one meaningful char', () => {
    // '学，' contains 学, so the punctuation riding along is fine.
    const result = clozeFromRange('学，而', 0, 2, []);
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isParkedQuote / countParkedQuotes
// ---------------------------------------------------------------------------

describe('isParkedQuote', () => {
  it('returns true when clozes is absent', () => {
    expect(isParkedQuote(makeQuote())).toBe(true);
  });

  it('returns true when clozes is an empty array', () => {
    expect(isParkedQuote(makeQuote({ clozes: [] }))).toBe(true);
  });

  it('returns false when clozes has at least one entry', () => {
    const cloze: Cloze = { id: 'c1', start: 0, end: 2 };
    expect(isParkedQuote(makeQuote({ clozes: [cloze] }))).toBe(false);
  });

  it('returns false for archived quotes even without clozes (not actionably parked)', () => {
    expect(isParkedQuote(makeQuote({ status: 'archived' }))).toBe(false);
  });

  it('returns true for reviewed quotes with no clozes (still actionably parked)', () => {
    expect(isParkedQuote(makeQuote({ status: 'reviewed' }))).toBe(true);
  });
});

describe('countParkedQuotes', () => {
  it('returns 0 for empty array', () => {
    expect(countParkedQuotes([])).toBe(0);
  });

  it('counts non-archived quotes with no clozes', () => {
    const quotes = [
      makeQuote({ id: 'q1' }),                          // parked (no clozes)
      makeQuote({ id: 'q2', clozes: [] }),              // parked (empty)
      makeQuote({ id: 'q3', clozes: [{ id: 'c1', start: 0, end: 2 }] }), // NOT parked
      makeQuote({ id: 'q4', status: 'archived' }),      // archived → not counted
    ];
    expect(countParkedQuotes(quotes)).toBe(2);
  });
});
