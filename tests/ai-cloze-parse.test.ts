import { describe, expect, it } from 'vitest';
import { parseClozeSuggestions, suggestionsToCandidates } from '../lib/ai/cloze-parse';
import type { Cloze } from '../lib/types';

describe('parseClozeSuggestions', () => {
  it('parses a valid blanks array', () => {
    const result = parseClozeSuggestions('{"blanks":[{"answer":"刚需","reason":"key"}]}');
    expect(result).toEqual({ ok: true, suggestions: [{ answer: '刚需', reason: 'key' }] });
  });

  it('rejects malformed JSON', () => {
    const result = parseClozeSuggestions('not json');
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object / missing blanks array', () => {
    expect(parseClozeSuggestions('[]').ok).toBe(false);
    expect(parseClozeSuggestions('{"foo":1}').ok).toBe(false);
  });

  it('drops entries without a non-empty string answer', () => {
    const result = parseClozeSuggestions('{"blanks":[{"answer":""},{"reason":"x"},{"answer":"刚需"}]}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestions).toEqual([{ answer: '刚需', reason: undefined }]);
  });
});

describe('suggestionsToCandidates', () => {
  const text = '满足人们的刚需才能持续满足';

  it('maps an exact substring to offsets', () => {
    const out = suggestionsToCandidates(text, [{ answer: '刚需', reason: 'k' }], []);
    expect(out).toHaveLength(1);
    expect(text.slice(out[0].cloze.start, out[0].cloze.end)).toBe('刚需');
    expect(out[0].reason).toBe('k');
  });

  it('ignores answers that are not a substring', () => {
    const out = suggestionsToCandidates(text, [{ answer: '股票' }], []);
    expect(out).toEqual([]);
  });

  it('picks the first occurrence not already covered', () => {
    // '满足' occurs at index 0 and again later; an existing cloze covers index 0.
    const existing: Cloze[] = [{ id: 'e', start: 0, end: 2 }];
    const out = suggestionsToCandidates(text, [{ answer: '满足' }], existing);
    expect(out).toHaveLength(1);
    expect(out[0].cloze.start).toBeGreaterThan(0);
    expect(text.slice(out[0].cloze.start, out[0].cloze.end)).toBe('满足');
  });

  it('drops a candidate whose only occurrences are all covered', () => {
    const existing: Cloze[] = [{ id: 'e', start: 5, end: 7 }]; // covers 刚需
    const out = suggestionsToCandidates(text, [{ answer: '刚需' }], existing);
    expect(out).toEqual([]);
  });

  it('drops overlapping candidates, preferring the longer span', () => {
    const out = suggestionsToCandidates('满足人们的刚需', [
      { answer: '刚' },
      { answer: '刚需' },
    ], []);
    expect(out).toHaveLength(1);
    expect(out[0].cloze.end - out[0].cloze.start).toBe(2);
  });

  it('returns candidates in document order', () => {
    const out = suggestionsToCandidates('满足人们的刚需', [
      { answer: '刚需' },
      { answer: '满足' },
    ], []);
    expect(out.map((c) => c.cloze.start)).toEqual([0, 5]);
  });
});
