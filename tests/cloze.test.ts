import { describe, expect, it } from 'vitest';
import { clozeFromRange, countParkedQuotes, isParkedQuote } from '../lib/cloze';
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
