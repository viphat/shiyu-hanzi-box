import { pinyin } from 'pinyin-pro';

export function toPinyin(text: string): string {
  return pinyin(text, { toneType: 'symbol', nonZh: 'consecutive' }).replace(/\s+/g, ' ').trim();
}
