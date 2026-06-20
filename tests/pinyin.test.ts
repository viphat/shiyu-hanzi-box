import { describe, expect, it } from 'vitest';
import { toPinyin } from '../lib/pinyin';

describe('toPinyin', () => {
  it('returns pinyin with tone marks for Chinese text', () => {
    expect(toPinyin('你好')).toBe('nǐ hǎo');
  });

  it('passes through non-Chinese characters', () => {
    expect(toPinyin('你好 world')).toBe('nǐ hǎo world');
  });

  it('returns empty string for empty input', () => {
    expect(toPinyin('')).toBe('');
  });
});
