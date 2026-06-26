import { describe, expect, it } from 'vitest';
import { clozeFromRange, countParkedQuotes, isParkedQuote, parseClozeMarkup, seedMarkup } from '../lib/cloze';
import type { Cloze, QuoteEntry } from '../lib/types';

function makeQuote(overrides: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1', kind: 'quote', text: '学而时习之', tags: [], note: '',
    status: 'inbox', createdAt: 0, updatedAt: 0, category: 'classic',
    sourceTitle: '', sourceUrl: '', sourceDomain: '', surrounding: '',
    ...overrides,
  };
}

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

describe('parseClozeMarkup', () => {
  it('parses a single brace pair into one cloze with de-braced offsets', () => {
    const result = parseClozeMarkup('满足人们的{刚需}，持续花钱');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('满足人们的刚需，持续花钱');
    expect(result.clozes).toHaveLength(1);
    expect(result.text.slice(result.clozes[0].start, result.clozes[0].end)).toBe('刚需');
    expect(result.clozes[0].start).toBe(5);
    expect(result.clozes[0].end).toBe(7);
  });

  it('parses multiple brace pairs in document order with correct offsets', () => {
    const result = parseClozeMarkup('{学}而时{习}之');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('学而时习之');
    expect(result.clozes.map((c) => [c.start, c.end])).toEqual([[0, 1], [3, 4]]);
  });

  it('rejects unbalanced braces', () => {
    expect(parseClozeMarkup('满足{刚需')).toEqual({ ok: false, reason: 'unbalanced' });
    expect(parseClozeMarkup('满足刚需}')).toEqual({ ok: false, reason: 'unbalanced' });
  });

  it('rejects nested braces', () => {
    expect(parseClozeMarkup('{a{b}c}')).toEqual({ ok: false, reason: 'nested' });
  });

  it('rejects an empty span', () => {
    expect(parseClozeMarkup('满足{}刚需')).toEqual({ ok: false, reason: 'empty-span' });
  });

  it('treats escaped braces as literal characters', () => {
    const result = parseClozeMarkup('用法 \\{ 与 \\}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('用法 { 与 }');
    expect(result.clozes).toHaveLength(0);
  });

  it('leaves wordId unset and hint unset on parsed clozes', () => {
    const result = parseClozeMarkup('{刚需}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clozes[0].wordId).toBeUndefined();
    expect(result.clozes[0].hint).toBeUndefined();
  });
});

describe('seedMarkup', () => {
  it('wraps existing cloze spans in braces', () => {
    const text = '满足人们的刚需，持续花钱';
    const clozes = [{ id: 'c1', start: 5, end: 7 }];
    expect(seedMarkup(text, clozes)).toBe('满足人们的{刚需}，持续花钱');
  });

  it('round-trips through parseClozeMarkup', () => {
    const text = '学而时习之，不亦说乎';
    const clozes = [
      { id: 'a', start: 0, end: 1 },
      { id: 'b', start: 3, end: 4 },
    ];
    const result = parseClozeMarkup(seedMarkup(text, clozes));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe(text);
    expect(result.clozes.map((c) => [c.start, c.end])).toEqual([[0, 1], [3, 4]]);
  });

  it('escapes literal braces already present in the text', () => {
    const text = '集合 {x} 表示';
    expect(seedMarkup(text, [])).toBe('集合 \\{x\\} 表示');
  });
});
