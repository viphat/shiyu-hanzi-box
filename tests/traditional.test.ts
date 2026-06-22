import { describe, expect, it } from 'vitest';
import { toTraditionalTaiwan } from '../lib/traditional';

describe('toTraditionalTaiwan', () => {
  it('converts basic Simplified to Traditional', () => {
    expect(toTraditionalTaiwan('学习')).toBe('學習');
  });

  it('applies Taiwan phrase-level variants (twp, not tw)', () => {
    expect(toTraditionalTaiwan('软件')).toBe('軟體');
    expect(toTraditionalTaiwan('自行车')).toBe('腳踏車');
  });

  it('handles one-to-many disambiguation by context', () => {
    expect(toTraditionalTaiwan('头发')).toBe('頭髮');
    expect(toTraditionalTaiwan('干杯')).toBe('乾杯');
  });

  it('passes through non-Chinese characters unchanged', () => {
    expect(toTraditionalTaiwan('hello 123')).toBe('hello 123');
  });

  it('returns empty string for empty input', () => {
    expect(toTraditionalTaiwan('')).toBe('');
  });

  it('handles mixed CJK and ASCII', () => {
    expect(toTraditionalTaiwan('Python语言')).toBe('Python語言');
  });
});
