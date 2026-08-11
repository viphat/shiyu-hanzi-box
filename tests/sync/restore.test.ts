import { describe, expect, it } from 'vitest';
import { planRestoreRemovals } from '../../lib/sync/restore';
import { legacyOccurrenceId } from '../../lib/sync/project';
import type { Cloze, Inbox, Occurrence, QuoteEntry, WordEntry } from '../../lib/types';

function quote(over: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: 'hi',
    note: '',
    status: 'inbox',
    tags: [],
    createdAt: 10,
    updatedAt: 20,
    sourceTitle: '',
    sourceUrl: '',
    sourceDomain: '',
    surrounding: '',
    ...over,
  };
}

function word(over: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'w1',
    kind: 'word',
    text: '你好',
    normalized: '你好',
    note: '',
    status: 'inbox',
    createdAt: 10,
    updatedAt: 20,
    occurrences: [],
    ...over,
  };
}

const occ = (capturedAt: number): Occurrence => ({
  sourceTitle: 't',
  sourceUrl: 'https://example.com',
  sourceDomain: 'example.com',
  surrounding: 's',
  capturedAt,
});

const inbox = (words: WordEntry[], quotes: QuoteEntry[]): Inbox => ({ words, quotes });

describe('planRestoreRemovals', () => {
  it('tombstones tags the restored backup no longer has', () => {
    const out = planRestoreRemovals(
      inbox([], [quote({ tags: ['a', 'b'] })]),
      inbox([], [quote({ tags: ['a'] })]),
    );
    expect(out.tags).toEqual([{ quoteId: 'q1', tags: ['b'] }]);
  });

  it('normalizes the restored tags before diffing', () => {
    const out = planRestoreRemovals(
      inbox([], [quote({ tags: ['a'] })]),
      inbox([], [quote({ tags: ['  A  '] })]),
    );
    expect(out.tags).toEqual([]);
  });

  it('tombstones blanks the restored backup no longer has', () => {
    const blanks: Cloze[] = [
      { id: 'a', start: 0, end: 1 },
      { id: 'b', start: 1, end: 2 },
    ];
    const out = planRestoreRemovals(
      inbox([], [quote({ clozes: blanks })]),
      inbox([], [quote({ clozes: [blanks[0]] })]),
    );
    expect(out.clozes).toEqual([{ quoteId: 'q1', clozeIds: ['b'] }]);
  });

  it('tombstones occurrences the restored backup no longer has', () => {
    const out = planRestoreRemovals(
      inbox([word({ occurrences: [occ(100), occ(200)] })], []),
      inbox([word({ occurrences: [occ(100)] })], []),
    );
    expect(out.occurrences).toEqual([
      { normalized: '你好', occurrenceId: legacyOccurrenceId('w1', occ(200)) },
    ]);
  });

  it('keys occurrence ids off the local word id, not the backup copy', () => {
    // A backup from another profile can carry a different id for the same
    // normalized word. Tombstones must match the ids projection actually
    // minted here, which derive from THIS device's word id.
    const out = planRestoreRemovals(
      inbox([word({ id: 'local', occurrences: [occ(100)] })], []),
      inbox([word({ id: 'from-backup', occurrences: [] })], []),
    );
    expect(out.occurrences).toEqual([
      { normalized: '你好', occurrenceId: legacyOccurrenceId('local', occ(100)) },
    ]);
  });

  it('matches words by normalized text, the sync logical key', () => {
    const out = planRestoreRemovals(
      inbox([word({ occurrences: [occ(100)] })], []),
      inbox([word({ normalized: '再见', text: '再见', occurrences: [] })], []),
    );
    // Different logical word — the restore does not carry 你好 at all.
    expect(out.occurrences).toEqual([]);
  });

  it('plans no member removals for an entry the restore drops entirely', () => {
    // The whole entry is tombstoned instead; tombstoning its members too would
    // only make it come back empty if something later restores it.
    const out = planRestoreRemovals(
      inbox(
        [word({ occurrences: [occ(100)] })],
        [quote({ tags: ['a'], clozes: [{ id: 'c', start: 0, end: 1 }] })],
      ),
      inbox([], []),
    );
    expect({ ...out, entities: out.entities.sort() }).toEqual({
      tags: [],
      clozes: [],
      occurrences: [],
      entities: ['quote:q1', 'word:你好'],
    });
  });

  it('plans nothing when the restore only adds', () => {
    const out = planRestoreRemovals(
      inbox([word()], [quote()]),
      inbox(
        [word({ occurrences: [occ(100)] })],
        [quote({ tags: ['a'], clozes: [{ id: 'c', start: 0, end: 1 }] })],
      ),
    );
    expect(out).toEqual({ tags: [], clozes: [], occurrences: [], entities: [] });
  });
});

describe('planRestoreRemovals entity deletions', () => {
  it('names the sync key of every entry the restore drops', () => {
    const out = planRestoreRemovals(
      inbox([word()], [quote(), quote({ id: 'q2' })]),
      inbox([], [quote()]),
    );
    expect(out.entities.sort()).toEqual(['quote:q2', 'word:你好']);
  });

  it('names nothing when the restore carries every entry', () => {
    const out = planRestoreRemovals(
      inbox([word()], [quote()]),
      inbox([word({ note: 'edited' })], [quote({ note: 'edited' })]),
    );
    expect(out.entities).toEqual([]);
  });

  it('keys a dropped word by normalized text, not its id', () => {
    const out = planRestoreRemovals(
      inbox([word({ id: 'whatever' })], []),
      inbox([], []),
    );
    expect(out.entities).toEqual(['word:你好']);
  });
});
