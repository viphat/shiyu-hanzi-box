import { describe, expect, it } from 'vitest';
import {
  createCedictStreamParser,
} from '../lib/dictionary';
import {
  isCvdictResultValid,
  isCvdictSizeAllowed,
  hashDictionaryEntries,
  MAX_CVDICT_DOWNLOAD_BYTES,
} from '../lib/cvdict';

const source = '#! version=1.0.1\n#! date=2024-12-02T17:46:19Z\n你好 你好 [ni3 hao3] /xin chào/\n學習 学习 [xue2 xi2] /học tập/\n';

describe('CVDICT parsing', () => {
  it('parses metadata and entries split across chunks', () => {
    const parser = createCedictStreamParser();
    parser.addChunk(source.slice(0, 31));
    parser.addChunk(source.slice(31));

    const result = parser.finish();

    expect(result.metadata).toEqual({ version: '1.0.1', release: '2024-12-02T17:46:19Z' });
    expect(result.entries[0]).toMatchObject({ simplified: '你好', definitions: ['xin chào'] });
  });

  it('rejects a byte count above the CVDICT ceiling', () => {
    expect(isCvdictSizeAllowed(MAX_CVDICT_DOWNLOAD_BYTES + 1)).toBe(false);
  });

  it('requires entries plus version and release metadata', () => {
    expect(isCvdictResultValid({ entries: [], skipped: 0, metadata: { version: '1.0.1', release: '2024-12-02' } })).toBe(false);
    expect(isCvdictResultValid({ entries: [{ traditional: '你好', simplified: '你好', pinyin: 'ni3 hao3', definitions: ['xin chào'] }], skipped: 0, metadata: { version: null, release: '2024-12-02' } })).toBe(false);
    expect(isCvdictResultValid({ entries: [{ traditional: '你好', simplified: '你好', pinyin: 'ni3 hao3', definitions: ['xin chào'] }], skipped: 0, metadata: { version: ' ', release: '2024-12-02' } })).toBe(false);
  });

  it('hashes materialized entries deterministically', () => {
    const entries = [{ index: 0, traditional: '你好', simplified: '你好', pinyin: 'ni3 hao3', definitions: ['xin chào'] }];

    expect(hashDictionaryEntries(entries)).toMatch(/^[a-f0-9]{8}$/);
    expect(hashDictionaryEntries(entries)).toBe(hashDictionaryEntries([...entries]));
  });
});
