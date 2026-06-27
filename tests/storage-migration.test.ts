import { describe, expect, it } from 'vitest';
import { migrateInboxV1ToV2 } from '../lib/storage';

describe('migrateInboxV1ToV2', () => {
  it('folds category into tags, drops uncategorized, dedupes, removes category', () => {
    const out = migrateInboxV1ToV2({
      words: [{ id: 'w', kind: 'word' }],
      quotes: [
        { id: 'q1', kind: 'quote', category: 'Poetry', tags: ['poetry', 'A'] },
        { id: 'q2', kind: 'quote', category: 'uncategorized', tags: ['b'] },
        { id: 'q3', kind: 'quote', category: 'News', tags: [] },
      ],
    });
    expect(out.quotes[0].tags).toEqual(['poetry', 'a']);
    expect('category' in out.quotes[0]).toBe(false);
    expect(out.quotes[1].tags).toEqual(['b']);
    expect(out.quotes[2].tags).toEqual(['news']);
    // Words are untouched.
    expect(out.words[0]).toEqual({ id: 'w', kind: 'word' });
  });

  it('tolerates quotes already lacking category (idempotent)', () => {
    const once = migrateInboxV1ToV2({ words: [], quotes: [{ id: 'q', kind: 'quote', category: 'X', tags: [] }] });
    const twice = migrateInboxV1ToV2(once);
    expect(twice.quotes[0].tags).toEqual(['x']);
  });
});
