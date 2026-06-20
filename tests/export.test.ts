import { describe, expect, it } from 'vitest';
import { buildExportMap, zipBytes } from '../lib/export';
import type { QuoteEntry, WordEntry } from '../lib/types';

const word: WordEntry = {
  id: 'w1',
  kind: 'word',
  text: '你好',
  normalized: '你好',
  tags: [],
  note: '',
  status: 'inbox',
  createdAt: Date.UTC(2026, 5, 20),
  updatedAt: 1,
  occurrences: [
    {
      sourceTitle: 'A',
      sourceUrl: 'https://a.com',
      sourceDomain: 'a.com',
      surrounding: '',
      capturedAt: Date.UTC(2026, 5, 20),
    },
  ],
};

const quote: QuoteEntry = {
  id: 'q1',
  kind: 'quote',
  text: 'x',
  category: 'uncategorized',
  tags: [],
  note: '',
  status: 'inbox',
  createdAt: Date.UTC(2026, 5, 21),
  updatedAt: 1,
  sourceTitle: '',
  sourceUrl: '',
  sourceDomain: '',
  surrounding: '',
};

describe('buildExportMap', () => {
  it('groups entries into daily file paths', () => {
    const map = buildExportMap([word], [quote]);
    expect(map.has('daily/2026-06-20.md')).toBe(true);
    expect(map.has('daily/2026-06-21.md')).toBe(true);
    expect(map.get('daily/2026-06-20.md')!).toContain('## Words');
    expect(map.get('daily/2026-06-21.md')!).toContain('## Quotes');
  });

  it('skips archived entries', () => {
    const archived = { ...word, status: 'archived' as const };
    const map = buildExportMap([archived], []);
    expect(map.size).toBe(0);
  });
});

describe('zipBytes', () => {
  it('produces a non-empty zip with the given files', async () => {
    const bytes = await zipBytes(new Map([['daily/2026-06-20.md', '# hi']]));
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
});
