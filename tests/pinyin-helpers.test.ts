import { describe, expect, it } from 'vitest';
import {
  cedictPinyinToChips,
  inferToneChips,
} from '../lib/pinyin-helpers';
import type { ToneChip } from '../lib/types';

describe('cedictPinyinToChips', () => {
  it('converts numbered CEDICT pinyin into tone chips', () => {
    const chips = cedictPinyinToChips('ni3 hao3', '你好');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toMatchObject<ToneChip>({
      text: '你',
      mark: 'nǐ',
      numbered: 'ni3',
      tone: 3,
      source: 'dictionary',
    });
  });

  it('maps neutral tone to 0', () => {
    const chips = cedictPinyinToChips('ni3 hao5', '你好');
    expect(chips[1].tone).toBe(0);
    expect(chips[1].numbered).toBe('hao5');
  });

  it('returns one chip per space-separated syllable', () => {
    const chips = cedictPinyinToChips('zhong1 guo2', '中国');
    expect(chips.map((c) => c.mark)).toEqual(['zhōng', 'guó']);
  });

  it('handles u-colon umlaut notation used by CEDICT', () => {
    const chips = cedictPinyinToChips('lu:4', '绿');
    expect(chips[0].mark).toBe('lǜ');
    expect(chips[0].tone).toBe(4);
  });
});

describe('inferToneChips', () => {
  it('infers one tone chip per Chinese character with no dictionary match', () => {
    const chips = inferToneChips('你好');
    expect(chips).toHaveLength(2);
    expect(chips[0].source).toBe('pinyin-pro');
    expect(chips.map((c) => c.text).join('')).toBe('你好');
    expect(chips.every((c) => c.tone >= 0 && c.tone <= 4)).toBe(true);
  });

  it('removes non-Chinese characters', () => {
    const chips = inferToneChips('你好!');
    expect(chips).toHaveLength(2);
  });
});
