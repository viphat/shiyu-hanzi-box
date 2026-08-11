import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRIFT_STORE,
  buildDriftPool,
  clampLevel,
  driftKey,
  getLevel,
  normalizeDriftStore,
  nudgeLevel,
  pickDriftCard,
  recentWindowSize,
  recordDriftDay,
  setLevel,
  type DriftStore,
} from '../lib/drift';
import type { Inbox, QuoteEntry, WordEntry } from '../lib/types';

function word(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'w1',
    kind: 'word',
    text: '你好',
    normalized: '你好',
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    occurrences: [],
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '学而时习之',
    tags: [],
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    sourceTitle: '',
    sourceUrl: '',
    sourceDomain: '',
    surrounding: '',
    ...overrides,
  };
}

function inbox(words: WordEntry[], quotes: QuoteEntry[]): Inbox {
  return { words, quotes };
}

/** Returns each value in turn, then repeats the last one. */
function seeded(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('driftKey', () => {
  it('keys words by normalized, not by id', () => {
    expect(driftKey(word({ id: 'anything', normalized: '你好' }))).toBe('word:你好');
  });

  it('keys quotes by a namespaced id', () => {
    expect(driftKey(quote({ id: 'q7' }))).toBe('quote:q7');
  });

  it('never collides a word with a quote of the same text', () => {
    expect(driftKey(word({ normalized: 'quote:q1' }))).not.toBe(driftKey(quote({ id: 'q1' })));
  });
});

describe('clampLevel', () => {
  it('clamps to the closed range [-2, 2]', () => {
    expect(clampLevel(9)).toBe(2);
    expect(clampLevel(-9)).toBe(-2);
    expect(clampLevel(0)).toBe(0);
  });

  it('rounds fractional levels read back from disk', () => {
    expect(clampLevel(1.4)).toBe(1);
  });
});

describe('nudgeLevel', () => {
  it('steps one notch per tap', () => {
    const store = nudgeLevel(EMPTY_DRIFT_STORE, '你好', 1);
    expect(getLevel(store, '你好')).toBe(1);
  });

  it('is fully reversible — up then down returns to neutral', () => {
    let store = nudgeLevel(EMPTY_DRIFT_STORE, '你好', 1);
    store = nudgeLevel(store, '你好', -1);
    expect(getLevel(store, '你好')).toBe(0);
  });

  it('saturates at the bounds rather than running away', () => {
    let store: DriftStore = EMPTY_DRIFT_STORE;
    for (let i = 0; i < 10; i += 1) store = nudgeLevel(store, '你好', -1);
    expect(getLevel(store, '你好')).toBe(-2);
  });

  it('does not mutate the input store', () => {
    const before = EMPTY_DRIFT_STORE;
    nudgeLevel(before, '你好', 1);
    expect(before.weights).toEqual({});
  });
});

describe('setLevel', () => {
  it('restores an exact previous level, which is how Back undoes a clamped tap', () => {
    const store = setLevel({ weights: { '你好': 2 }, days: {} }, '你好', 2);
    expect(getLevel(setLevel(store, '你好', 2), '你好')).toBe(2);
  });

  it('drops the key entirely when set back to neutral', () => {
    const store = setLevel({ weights: { '你好': 1 }, days: {} }, '你好', 0);
    expect(store.weights).toEqual({});
  });
});

describe('recordDriftDay', () => {
  it('counts a card drifted', () => {
    expect(recordDriftDay(EMPTY_DRIFT_STORE, '2026-08-11', 1).days).toEqual({ '2026-08-11': 1 });
  });

  it('decrements when Back undoes a card', () => {
    const store = recordDriftDay(recordDriftDay(EMPTY_DRIFT_STORE, '2026-08-11', 1), '2026-08-11', 1);
    expect(recordDriftDay(store, '2026-08-11', -1).days).toEqual({ '2026-08-11': 1 });
  });

  it('removes the day rather than storing a zero', () => {
    const store = recordDriftDay(EMPTY_DRIFT_STORE, '2026-08-11', 1);
    expect(recordDriftDay(store, '2026-08-11', -1).days).toEqual({});
  });

  it('never goes negative', () => {
    expect(recordDriftDay(EMPTY_DRIFT_STORE, '2026-08-11', -1).days).toEqual({});
  });
});

describe('buildDriftPool', () => {
  it('mixes words and quotes', () => {
    const pool = buildDriftPool(inbox([word()], [quote()]));
    expect(pool.map(driftKey).sort()).toEqual(['quote:q1', 'word:你好']);
  });

  it('includes parked quotes, which SRS can never show', () => {
    const pool = buildDriftPool(inbox([], [quote({ clozes: [] })]));
    expect(pool).toHaveLength(1);
  });

  it('excludes archived entries', () => {
    const pool = buildDriftPool(
      inbox([word({ status: 'archived' })], [quote({ status: 'archived' })]),
    );
    expect(pool).toEqual([]);
  });

  it('keeps reviewed entries', () => {
    expect(buildDriftPool(inbox([word({ status: 'reviewed' })], []))).toHaveLength(1);
  });

  it('is deterministically ordered so draws are reproducible', () => {
    const a = buildDriftPool(inbox([word({ normalized: '乙' }), word({ normalized: '甲' })], []));
    const b = buildDriftPool(inbox([word({ normalized: '甲' }), word({ normalized: '乙' })], []));
    expect(a.map(driftKey)).toEqual(b.map(driftKey));
  });
});

describe('recentWindowSize', () => {
  it('can never exclude the whole pool', () => {
    for (const size of [1, 2, 3, 10, 41]) {
      expect(recentWindowSize(size)).toBeLessThan(size);
    }
  });

  it('is zero for a single-entry pool', () => {
    expect(recentWindowSize(1)).toBe(0);
  });

  it('caps at 20 for large pools', () => {
    expect(recentWindowSize(1000)).toBe(20);
  });
});

describe('pickDriftCard', () => {
  const a = word({ id: 'wa', normalized: 'a' });
  const b = word({ id: 'wb', normalized: 'b' });
  const pool = buildDriftPool(inbox([a, b], []));

  it('returns null for an empty pool', () => {
    expect(pickDriftCard([], EMPTY_DRIFT_STORE, [], () => 0)).toBeNull();
  });

  it('draws proportionally to 2 ** level', () => {
    // a at level 2 => weight 4, b at level 0 => weight 1, total 5.
    const store: DriftStore = { weights: { 'word:a': 2 }, days: {} };
    // roll 2.5 lands inside a's [0, 4) band.
    expect(driftKey(pickDriftCard(pool, store, [], seeded([0.5]))!)).toBe('word:a');
    // roll 4.5 lands inside b's [4, 5) band.
    expect(driftKey(pickDriftCard(pool, store, [], seeded([0.9]))!)).toBe('word:b');
  });

  it('treats an absent key as neutral weight 1', () => {
    // Both neutral, total 2; roll 1.5 lands in b's band.
    expect(driftKey(pickDriftCard(pool, EMPTY_DRIFT_STORE, [], seeded([0.75]))!)).toBe('word:b');
  });

  it('excludes keys inside the recent window', () => {
    // Pool of 2 => window 1, so the single recent key is blocked.
    expect(driftKey(pickDriftCard(pool, EMPTY_DRIFT_STORE, ['word:a'], seeded([0]))!)).toBe('word:b');
  });

  it('only honours the last `window` recent keys', () => {
    // Window is 1, so 'b' has aged out and only 'a' is blocked.
    expect(driftKey(pickDriftCard(pool, EMPTY_DRIFT_STORE, ['word:b', 'word:a'], seeded([0]))!)).toBe('word:b');
  });

  it('repeats the only card in a single-entry pool', () => {
    const solo = buildDriftPool(inbox([a], []));
    expect(driftKey(pickDriftCard(solo, EMPTY_DRIFT_STORE, ['word:a'], seeded([0]))!)).toBe('word:a');
  });

  it('ignores orphaned weight keys for entries no longer in the pool', () => {
    // 'gone' is not a pool entry, so its heavy weight (level 2 => 4x) must
    // never enter the candidate set or the weight total. Both real entries
    // are neutral, so the correct total is 2 ('a' at [0,1), 'b' at [1,2)).
    //
    // A hypothetical bug that summed 2 ** level over every key in
    // store.weights — including the orphan — instead of only over `usable`,
    // would compute total = 4 (gone, level 2) + 1 (a) + 1 (b) = 6.
    //
    // At roll = 0.3 the two implementations genuinely disagree:
    //   correct: roll = 0.3 * 2 = 0.6, which falls in a's [0,1) band -> 'a'.
    //   buggy:   roll = 0.3 * 6 = 1.8, which overshoots a's [0,1) band,
    //            leaving 1.8 - 1 = 0.8, which then falls in b's [1,2)
    //            (i.e. remaining [0,1)) band -> 'b'.
    // So asserting 'a' actually pins that the total wasn't inflated by the
    // orphan — a test that only ever exercises roll < 1 (e.g. seed 0.1)
    // would pass under both implementations and prove nothing.
    const store: DriftStore = { weights: { gone: 2, 'word:a': 0, 'word:b': 0 }, days: {} };
    expect(driftKey(pickDriftCard(pool, store, [], seeded([0.3]))!)).toBe('word:a');
  });

  it('never returns null for a non-empty pool even at roll 1', () => {
    expect(pickDriftCard(pool, EMPTY_DRIFT_STORE, [], seeded([0.999999999]))).not.toBeNull();
  });
});

describe('normalizeDriftStore', () => {
  it('returns an empty store for missing input', () => {
    expect(normalizeDriftStore(undefined)).toEqual({ weights: {}, days: {} });
    expect(normalizeDriftStore(null)).toEqual({ weights: {}, days: {} });
  });

  it('clamps out-of-range persisted levels', () => {
    expect(normalizeDriftStore({ weights: { a: 9, b: -9 } as never, days: {} }).weights)
      .toEqual({ a: 2, b: -2 });
  });

  it('drops neutral levels so the store stays small', () => {
    expect(normalizeDriftStore({ weights: { a: 0 } as never, days: {} }).weights).toEqual({});
  });

  it('drops malformed weights rather than throwing', () => {
    const store = normalizeDriftStore({ weights: { a: 'x', b: null, c: 1 } as never, days: {} });
    expect(store.weights).toEqual({ c: 1 });
  });

  it('drops day keys that are not YYYY-MM-DD', () => {
    const store = normalizeDriftStore({
      weights: {},
      days: { '2026-08-11': 3, yesterday: 5 } as never,
    });
    expect(store.days).toEqual({ '2026-08-11': 3 });
  });

  it('drops non-positive and non-finite day counts', () => {
    const store = normalizeDriftStore({
      weights: {},
      days: { '2026-08-11': 0, '2026-08-12': -4, '2026-08-13': NaN } as never,
    });
    expect(store.days).toEqual({});
  });
});
