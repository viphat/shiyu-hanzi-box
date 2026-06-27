import { describe, expect, it } from 'vitest';
import { deleteEntity, mergeSyncState } from '../../lib/sync/merge';
import { projectInbox, wordKey } from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import type { Inbox, WordEntry } from '../../lib/types';

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
