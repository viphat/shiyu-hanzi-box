import { describe, expect, it } from 'vitest';
import {
  addTag,
  migrateQuoteCategoryToTags,
  normalizeTag,
  normalizeTags,
  planTagWrite,
  removeTag,
  tagCounts,
} from '../lib/tags';
import type { QuoteEntry } from '../lib/types';

function quote(over: Partial<QuoteEntry> & { category?: string } = {}): QuoteEntry & { category?: string } {
  return {
    id: over.id ?? 'q1',
    kind: 'quote',
    text: 't',
    note: '',
    status: 'inbox',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    sourceTitle: '',
    sourceUrl: '',
    sourceDomain: '',
    surrounding: '',
    ...over,
  } as QuoteEntry & { category?: string };
}

describe('normalizeTag', () => {
  it('lowercases, trims, and collapses internal whitespace', () => {
    expect(normalizeTag('  Hello   World  ')).toBe('hello world');
  });
  it('returns empty string for whitespace-only input', () => {
    expect(normalizeTag('   ')).toBe('');
  });
});

describe('normalizeTags', () => {
  it('drops empties and dedupes preserving first-seen order', () => {
    expect(normalizeTags(['B', 'a', '  ', 'b', 'A'])).toEqual(['b', 'a']);
  });
});

describe('addTag / removeTag', () => {
  it('addTag appends normalized, idempotent', () => {
    expect(addTag(['a'], 'B')).toEqual(['a', 'b']);
    expect(addTag(['a', 'b'], ' B ')).toEqual(['a', 'b']);
  });
  it('removeTag removes normalized, idempotent', () => {
    expect(removeTag(['a', 'b'], 'B')).toEqual(['a']);
    expect(removeTag(['a'], 'z')).toEqual(['a']);
  });
  it('returns new arrays (no mutation)', () => {
    const src = ['a'];
    addTag(src, 'b');
    removeTag(src, 'a');
    expect(src).toEqual(['a']);
  });
});

describe('tagCounts', () => {
  it('counts frequency across quotes', () => {
    const counts = tagCounts([
      quote({ id: 'q1', tags: ['a', 'b'] }),
      quote({ id: 'q2', tags: ['a'] }),
    ]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
  });
});

describe('planTagWrite', () => {
  it('normalizes next and reports removed tags', () => {
    expect(planTagWrite(['a', 'b'], ['A', 'C'])).toEqual({
      next: ['a', 'c'],
      removed: ['b'],
    });
  });
  it('reports no removals on a pure add', () => {
    expect(planTagWrite(['a'], ['a', 'b'])).toEqual({
      next: ['a', 'b'],
      removed: [],
    });
  });
});

describe('migrateQuoteCategoryToTags', () => {
  it('folds a non-uncategorized category into tags and drops the field', () => {
    const out = migrateQuoteCategoryToTags(quote({ category: 'Poetry', tags: ['a'] }));
    expect(out.tags).toEqual(['a', 'poetry']);
    expect('category' in out).toBe(false);
  });
  it('drops uncategorized without adding a tag', () => {
    const out = migrateQuoteCategoryToTags(quote({ category: 'uncategorized', tags: ['a'] }));
    expect(out.tags).toEqual(['a']);
  });
  it('is idempotent and tolerates a missing category', () => {
    const once = migrateQuoteCategoryToTags(quote({ category: 'Poetry', tags: [] }));
    const twice = migrateQuoteCategoryToTags(once);
    expect(twice.tags).toEqual(['poetry']);
    const noCat = migrateQuoteCategoryToTags({ tags: ['x'] });
    expect(noCat.tags).toEqual(['x']);
  });
  it('collapses a category that duplicates an existing tag', () => {
    const out = migrateQuoteCategoryToTags(quote({ category: 'Poetry', tags: ['poetry'] }));
    expect(out.tags).toEqual(['poetry']);
  });
});
