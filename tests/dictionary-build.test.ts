import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCompactAsset, materializeEntries } from '../lib/dictionary';
import type { CompactDictionaryAsset } from '../lib/types';

const sample = readFileSync(
  join(import.meta.dirname, 'fixtures/cedict-sample.txt'),
  'utf8',
);

describe('buildCompactAsset', () => {
  it('builds a compact asset with metadata and columnar data', () => {
    const asset = buildCompactAsset(sample, {
      sourceUrl: 'https://example/cedict',
      license: 'CC-BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    });
    expect(asset.meta.source).toBe('CC-CEDICT');
    expect(asset.meta.release).toBe('2026-06-20');
    expect(asset.meta.sourceUrl).toBe('https://example/cedict');
    expect(asset.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(asset.meta.hash).toMatch(/^[0-9a-f]{8,}$/);
    expect(asset.columns.simplified).toHaveLength(6);
    expect(asset.columns.traditional).toHaveLength(6);
    expect(asset.columns.pinyin).toHaveLength(6);
    expect(asset.columns.definitionRanges).toHaveLength(6);
  });

  it('dedupes identical definition sequences across entries', () => {
    const asset = buildCompactAsset('A A [a1] /shared def/\nB B [b1] /shared def/', {
      sourceUrl: '',
      license: '',
      licenseUrl: '',
    });
    expect(asset.columns.definitions).toEqual(['shared def']);
    expect(asset.columns.definitionRanges).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('stores ranges that cover each entry definitions exactly', () => {
    const asset = buildCompactAsset(sample, {
      sourceUrl: '',
      license: '',
      licenseUrl: '',
    });
    expect(asset.columns.definitionRanges[0]).toEqual([0, 2]);
  });

  it('keeps repeated single definitions from corrupting later multi-definition ranges', () => {
    const asset = buildCompactAsset(
      [
        'A A [a1] /first/shared/',
        'B B [b1] /other/',
        'C C [c1] /shared/',
      ].join('\n'),
      { sourceUrl: '', license: '', licenseUrl: '' },
    );
    const entries = materializeEntries(asset);
    expect(entries[0].definitions).toEqual(['first', 'shared']);
    expect(entries[1].definitions).toEqual(['other']);
    expect(entries[2].definitions).toEqual(['shared']);
  });
});

describe('materializeEntries', () => {
  it('rebuilds DictionaryEntry[] from a compact asset', () => {
    const asset: CompactDictionaryAsset = buildCompactAsset(sample, {
      sourceUrl: '',
      license: '',
      licenseUrl: '',
    });
    const entries = materializeEntries(asset);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toMatchObject({
      index: 0,
      traditional: '你好',
      simplified: '你好',
      pinyin: 'ni3 hao3',
      definitions: ['hello', 'good day'],
    });
  });
});
