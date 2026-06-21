import { pinyin } from 'pinyin-pro';
import type { ToneChip } from './types';

const CJK = /[\u3400-\u9fff]/;
const TONE_NUM: Record<string, 0 | 1 | 2 | 3 | 4> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 0,
};

const MARKS: Record<string, [string, string, string, string]> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

/**
 * Convert a CC-CEDICT numbered pinyin string ("ni3 hao3") into per-syllable
 * tone chips aligned to the Chinese characters in `word`.
 */
export function cedictPinyinToChips(
  cedictPinyin: string,
  word: string,
): ToneChip[] {
  const chars = chineseChars(word);
  return cedictPinyin
    .trim()
    .split(/\s+/)
    .filter((syl) => syl.length > 0)
    .map((syl, index) => {
      const toneDigit = syl.slice(-1);
      const tone = TONE_NUM[toneDigit] ?? 0;
      return {
        text: chars[index] ?? '',
        mark: markNumberedPinyin(syl, tone),
        numbered: syl,
        tone,
        source: 'dictionary' as const,
      };
    });
}

/**
 * Infer one tone chip per Chinese character using pinyin-pro, used when no
 * exact dictionary match exists.
 */
export function inferToneChips(word: string): ToneChip[] {
  return chineseChars(word).map((ch) => {
    const mark = pinyin(ch, { toneType: 'symbol', nonZh: 'removed' }).trim();
    const numbered = pinyin(ch, { toneType: 'num', nonZh: 'removed' }).trim();
    return {
      text: ch,
      mark,
      numbered,
      tone: toneFromNumbered(numbered),
      source: 'pinyin-pro' as const,
    };
  });
}

function chineseChars(word: string): string[] {
  return Array.from(word).filter((ch) => CJK.test(ch));
}

function toneFromNumbered(numbered: string): 0 | 1 | 2 | 3 | 4 {
  const match = numbered.match(/[1-5]$/);
  return match ? TONE_NUM[match[0]] : 0;
}

function markNumberedPinyin(numbered: string, tone: 0 | 1 | 2 | 3 | 4): string {
  const base = numbered.replace(/[0-5]$/, '').replace(/u:/g, 'ü').replace(/v/g, 'ü');
  if (tone === 0) return base;

  const lower = base.toLowerCase();
  const vowelIndex = chooseToneVowelIndex(lower);
  if (vowelIndex === -1) return base;

  const vowel = lower[vowelIndex];
  const marked = MARKS[vowel]?.[tone - 1];
  if (!marked) return base;
  return base.slice(0, vowelIndex) + marked + base.slice(vowelIndex + 1);
}

function chooseToneVowelIndex(syllable: string): number {
  const a = syllable.indexOf('a');
  if (a !== -1) return a;
  const e = syllable.indexOf('e');
  if (e !== -1) return e;
  const ou = syllable.indexOf('ou');
  if (ou !== -1) return ou;
  for (let i = syllable.length - 1; i >= 0; i -= 1) {
    if ('ioüu'.includes(syllable[i])) return i;
  }
  return -1;
}
