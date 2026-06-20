import { describe, it, expect } from 'vitest';
import { normalizeText } from '../lib/normalize';

describe('normalizeText', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeText('  你好  ')).toBe('你好');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeText('你\n好\t世 界')).toBe('你好世界');
  });

  it('strips leading/trailing CJK punctuation', () => {
    expect(normalizeText('"你好"。')).toBe('你好');
    expect(normalizeText('「你好」')).toBe('你好');
    expect(normalizeText('（你好）')).toBe('你好');
  });

  it('does not strip internal CJK punctuation', () => {
    expect(normalizeText('你好，世界')).toBe('你好，世界');
  });

  it('converts full-width latin to half-width (and lowercases per the lowercase rule)', () => {
    expect(normalizeText('ＡＢＣ')).toBe('abc');
  });

  it('lowercases latin letters', () => {
    expect(normalizeText('Hello')).toBe('hello');
  });

  it('is idempotent', () => {
    const once = normalizeText('  ＡＢＣ。 ');
    expect(normalizeText(once)).toBe(once);
  });

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('');
  });
});
