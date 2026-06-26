import { describe, expect, it } from 'vitest';
import { suggestClozes } from '../lib/cloze';
import type { WordEntry } from '../lib/types';

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
