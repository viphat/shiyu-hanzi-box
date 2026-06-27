import { describe, expect, it } from 'vitest';
import { quoteMatchesTags } from '../lib/tags';
import type { QuoteEntry } from '../lib/types';

const q = (tags: string[]) => ({ tags } as QuoteEntry);

describe('quoteMatchesTags (OR semantics)', () => {
  it('matches all when no tags selected', () => {
    expect(quoteMatchesTags(q(['a']), new Set())).toBe(true);
  });
  it('matches when any selected tag is present', () => {
    expect(quoteMatchesTags(q(['a', 'x']), new Set(['x', 'y']))).toBe(true);
  });
  it('does not match when no selected tag is present', () => {
    expect(quoteMatchesTags(q(['a']), new Set(['x']))).toBe(false);
  });
});
