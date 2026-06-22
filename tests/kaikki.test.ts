import { describe, expect, it } from 'vitest';
import {
  createKaikkiJsonlStreamParser,
  hashKaikkiEntries,
  isAllowedKaikkiUrl,
  manualKaikkiDownloadUrl,
  parseKaikkiJsonl,
} from '../lib/kaikki';
import { buildIndex, lookupExact } from '../lib/dictionary';

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

  it('imports Kaikki forms as variants while filtering no-gloss soft redirects', () => {
    const jsonl = [
      JSON.stringify({
        word: '滯漲',
        lang_code: 'zh',
        sounds: [{ zh_pron: 'zhìzhàng', tags: ['Mandarin', 'Pinyin'] }],
        forms: [{ form: '滞涨', tags: ['Simplified-Chinese'] }],
        senses: [{ glosses: ['stagflation'] }],
      }),
      JSON.stringify({
        word: '滞涨',
        lang_code: 'zh',
        pos: 'soft-redirect',
        senses: [{ tags: ['no-gloss'] }],
      }),
    ].join('\n');

    const result = parseKaikkiJsonl(jsonl);
    const hits = lookupExact(buildIndex(result.entries), '滞涨');

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].variants).toEqual(['滞涨']);
    expect(result.skipped).toBe(1);
    expect(hits).toHaveLength(1);
    expect(hits[0].definitions).toEqual(['stagflation']);
  });
});

describe('createKaikkiJsonlStreamParser', () => {
  it('parses JSONL split across chunks without loading the whole file text', () => {
    const first = JSON.stringify({
      word: '滞胀',
      lang_code: 'zh',
      senses: [{ glosses: ['stagflation'] }],
    });
    const second = JSON.stringify({
      word: '文言',
      lang_code: 'zh',
      senses: [{ glosses: ['Classical Chinese'] }],
    });
    const parser = createKaikkiJsonlStreamParser();

    parser.addChunk(`${first}\n${second.slice(0, 12)}`);
    parser.addChunk(`${second.slice(12)}\n{bad json`);
    const result = parser.finish();

    expect(result.entries.map((entry) => entry.simplified)).toEqual(['滞胀', '文言']);
    expect(result.entries.map((entry) => entry.definitions[0])).toEqual([
      'stagflation',
      'Classical Chinese',
    ]);
    expect(result.skipped).toBe(1);
  });

  it('reports the current entry and skipped counts before finish', () => {
    const parser = createKaikkiJsonlStreamParser();
    parser.addChunk(`${JSON.stringify({
      word: '龍',
      lang_code: 'zh',
      senses: [{ glosses: ['dragon'] }],
    })}\nnot json\n`);

    expect(parser.snapshot()).toEqual({ entryCount: 1, skipped: 1 });
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

describe('manualKaikkiDownloadUrl', () => {
  it('returns the configured Kaikki URL for manual download', () => {
    const url = 'https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl';

    expect(manualKaikkiDownloadUrl(url)).toBe(url);
  });

  it('returns null for unsupported download hosts', () => {
    expect(manualKaikkiDownloadUrl('https://example.com/dump.jsonl')).toBeNull();
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
