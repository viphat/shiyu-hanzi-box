// tests/sync/merge.test.ts
import { describe, expect, it } from 'vitest';
import { deleteEntity, mergeSyncState, mergeQuoteNodes } from '../../lib/sync/merge';
import { projectInbox, materialize, wordKey } from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import type { Inbox, WordEntry, QuoteEntry } from '../../lib/types';
import type { QuoteNode } from '../../lib/sync/types';

function word(over: Partial<WordEntry>): WordEntry {
  return {
    id: 'w', kind: 'word', text: '你好', normalized: '你好', note: '', status: 'inbox',
    createdAt: 10, updatedAt: 10, occurrences: [], ...over,
  };
}
const proj = (inbox: Inbox, replicaId: string, wallTime: number) =>
  projectInbox(inbox, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, { replicaId, wallTime });

describe('mergeSyncState', () => {
  it('is idempotent', () => {
    const a = proj({ words: [word({})], quotes: [] }, 'A', 100);
    expect(mergeSyncState(a, a)).toEqual(a);
  });

  it('is commutative on independent words', () => {
    const a = proj({ words: [word({ id: 'a', normalized: '你好', text: '你好' })], quotes: [] }, 'A', 100);
    const b = proj({ words: [word({ id: 'b', normalized: '再见', text: '再见' })], quotes: [] }, 'B', 100);
    const ab = mergeSyncState(a, b);
    const ba = mergeSyncState(b, a);
    expect(Object.keys(ab.words).sort()).toEqual(Object.keys(ba.words).sort());
  });

  it('converges same-normalized words and unions occurrences', () => {
    const occ = (capturedAt: number) => ({ sourceTitle: 't', sourceUrl: `u${capturedAt}`, sourceDomain: 'd', surrounding: 's', capturedAt });
    const a = proj({ words: [word({ id: 'a', occurrences: [occ(1)] })], quotes: [] }, 'A', 100);
    const b = proj({ words: [word({ id: 'b', occurrences: [occ(2)] })], quotes: [] }, 'B', 100);
    const merged = mergeSyncState(a, b);
    const node = merged.words[wordKey('你好')];
    expect(Object.keys(node.occurrences)).toHaveLength(2);
    expect(node.fields.id?.value).toBe('a'); // earliest createdAt tie -> smallest id 'a'
  });

  it('suppresses a word resurrection from a stale replica', () => {
    const a = proj({ words: [word({ updatedAt: 50 })], quotes: [] }, 'A', 100);
    const deleted = deleteEntity(a, wordKey('你好'), { wallTime: 200, counter: 0, replicaId: 'A' });
    const stale = proj({ words: [word({ updatedAt: 50 })], quotes: [] }, 'B', 60);
    const merged = mergeSyncState(deleted, stale);
    expect(merged.tombstones[wordKey('你好')]).toBeDefined();
  });
});

describe('merge algebra', () => {
  const occ = (u: string) => ({ sourceTitle: 't', sourceUrl: u, sourceDomain: 'd', surrounding: 's', capturedAt: 1 });
  const a = proj({ words: [word({ id: 'a', occurrences: [occ('u1')] })], quotes: [] }, 'A', 100);
  const b = proj({ words: [word({ id: 'b', occurrences: [occ('u2')] })], quotes: [] }, 'B', 100);
  const c = proj({ words: [word({ id: 'c', normalized: '好', text: '好' })], quotes: [] }, 'C', 100);

  it('is associative', () => {
    const left = mergeSyncState(mergeSyncState(a, b), c);
    const right = mergeSyncState(a, mergeSyncState(b, c));
    expect(left).toEqual(right);
  });

  it('converges regardless of order', () => {
    const order1 = mergeSyncState(mergeSyncState(a, b), c);
    const order2 = mergeSyncState(mergeSyncState(c, a), b);
    expect(order1).toEqual(order2);
  });
});

function qnode(over: Partial<QuoteNode> = {}): QuoteNode {
  return {
    id: 'q1',
    fields: { updatedAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } } },
    createdAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } },
    tags: {},
    tagTombstones: {},
    reviewEvents: {},
    ...over,
  };
}
const ts = (w: number, r = 'A') => ({ wallTime: w, counter: 0, replicaId: r });

describe('mergeQuoteNodes tag OR-Set', () => {
  it('unions concurrent adds of different tags', () => {
    const a = qnode({ tags: { a: ts(10) } });
    const b = qnode({ tags: { b: ts(11, 'B') } });
    const m = mergeQuoteNodes(a, b);
    expect(Object.keys(m.tags!).sort()).toEqual(['a', 'b']);
  });

  it('a remove suppresses a stale add it causally saw', () => {
    const a = qnode({ tags: { a: ts(10) }, tagTombstones: { a: ts(20) } });
    const b = qnode({ tags: { a: ts(10) } });
    const m = mergeQuoteNodes(a, b);
    // add stamp 10 <= tombstone 20 => suppressed
    expect(m.tagTombstones!.a.wallTime).toBe(20);
    expect(m.tags!.a.wallTime).toBe(10);
  });

  it('keeps the max add stamp and max tombstone per tag', () => {
    const a = qnode({ tags: { a: ts(10) }, tagTombstones: { a: ts(15) } });
    const b = qnode({ tags: { a: ts(30, 'B') }, tagTombstones: {} });
    const m = mergeQuoteNodes(a, b);
    expect(m.tags!.a.wallTime).toBe(30);
    expect(m.tagTombstones!.a.wallTime).toBe(15);
  });
});

function quoteInbox(tags: string[], updatedAt: number): Inbox {
  return {
    words: [],
    quotes: [{
      id: 'q1', kind: 'quote', text: 'hi', note: '', status: 'inbox',
      tags, createdAt: 10, updatedAt,
      sourceTitle: '', sourceUrl: '', sourceDomain: '', surrounding: '',
    } as QuoteEntry],
  };
}

describe('tag resurrection regression', () => {
  it('a remove on A is not resurrected by an unrelated edit on B', () => {
    const ctxA = { replicaId: 'A', wallTime: 100 };
    const ctxB = { replicaId: 'B', wallTime: 100 };

    // Both start with tag "foo" at updatedAt 20.
    let a = projectInbox(quoteInbox(['foo'], 20), DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctxA);

    // A removes foo: record tombstone at wallTime 50, project the now-empty tag set.
    a.quotes.q1.tagTombstones = { foo: { wallTime: 50, counter: 0, replicaId: 'A' } };
    a = mergeSyncState(
      a,
      projectInbox(quoteInbox([], 50), DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctxA, a),
    );
    expect(materialize(a).inbox.quotes[0].tags).toEqual([]); // suppressed on A

    // B still holds foo and edits its note (updatedAt 80) WITHOUT seeing the tombstone.
    const bPrev = projectInbox(quoteInbox(['foo'], 20), DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctxB);
    const b = mergeSyncState(
      bPrev,
      projectInbox(quoteInbox(['foo'], 80), DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctxB, bPrev),
    );
    // Carry-forward keeps foo's add stamp at 20, NOT 80.
    expect(b.quotes.q1.tags!.foo.wallTime).toBe(20);

    // A merges B's replica: foo must stay removed.
    const merged = mergeSyncState(a, b);
    expect(materialize(merged).inbox.quotes[0].tags).toEqual([]);
  });
});
