import { describe, expect, it } from 'vitest';
import {
  hashKaikkiEntries,
  isAllowedKaikkiUrl,
  parseKaikkiJsonl,
} from '../lib/kaikki';

describe('parseKaikkiJsonl', () => {
  it('parses Chinese JSONL entries and skips invalid or unsupported lines', () => {
    const jsonl = [
      JSON.stringify({
        word: '滞胀',
        lang_code: 'zh',
        lang: 'Chinese',
        sounds: [{ roman: 'zhìzhàng' }],
        senses: [{ glosses: ['stagflation'] }],
      }),
      '{bad json',
      JSON.stringify({ word: 'hello', lang_code: 'en', senses: [{ glosses: ['hi'] }] }),
    ].join('\n');

    const result = parseKaikkiJsonl(jsonl);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      index: 0,
      simplified: '滞胀',
      traditional: '滞胀',
      pinyin: 'zhìzhàng',
      definitions: ['stagflation'],
    });
    expect(result.skipped).toBe(2);
  });

  it('dedupes glosses for repeated surfaces', () => {
    const jsonl = [
      JSON.stringify({
        word: '龍',
        lang_code: 'zh',
        senses: [{ glosses: ['dragon', 'dragon'] }],
      }),
      JSON.stringify({
        word: '龍',
        lang: 'Chinese',
        senses: [{ glosses: ['imperial symbol'] }],
      }),
    ].join('\n');

    const result = parseKaikkiJsonl(jsonl);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].definitions).toEqual(['dragon', 'imperial symbol']);
    expect(result.entries[0].pinyin).toBe('');
  });

  it('uses raw glosses when normalized glosses are absent', () => {
    const result = parseKaikkiJsonl(
      JSON.stringify({
        word: '文言',
        lang_code: 'zh',
        senses: [{ raw_glosses: ['Classical Chinese'] }],
      }),
    );

    expect(result.entries[0].definitions).toEqual(['Classical Chinese']);
  });
});

describe('isAllowedKaikkiUrl', () => {
  it('accepts kaikki.org HTTPS URLs', () => {
    expect(
      isAllowedKaikkiUrl('https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl'),
    ).toBe(true);
  });

  it('rejects non-Kaikki or non-HTTPS URLs', () => {
    expect(isAllowedKaikkiUrl('https://example.com/dump.jsonl')).toBe(false);
    expect(isAllowedKaikkiUrl('http://kaikki.org/dump.jsonl')).toBe(false);
    expect(isAllowedKaikkiUrl('not a url')).toBe(false);
  });
});

describe('hashKaikkiEntries', () => {
  it('hashes entries deterministically', () => {
    const result = parseKaikkiJsonl(
      JSON.stringify({
        word: '滞胀',
        lang_code: 'zh',
        senses: [{ glosses: ['stagflation'] }],
      }),
    );

    expect(hashKaikkiEntries(result.entries)).toMatch(/^[a-f0-9]{8}$/);
    expect(hashKaikkiEntries(result.entries)).toBe(hashKaikkiEntries(result.entries));
  });
});
