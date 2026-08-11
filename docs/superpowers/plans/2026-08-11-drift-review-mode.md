# Drift Review Mode (漫读) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Drift (漫读), a second review mode selectable from Settings, that shows saved words and quotes one at a time in weighted random order with everything visible and two thumbs that shape what resurfaces.

**Architecture:** A pure model module (`lib/drift.ts`) holds the weight math and the weighted picker; a thin storage wrapper (`lib/drift-storage.ts`) persists it to a `local:drift` item **outside the inbox**, because the sync coordinator replaces the whole inbox with `materialize()` output and would destroy any field it does not project. A `reviewMode` app setting decides whether the dashboard's Review tab renders the existing `ReviewQueue` or the new `DriftView`. FSRS state is never written by Drift.

**Tech Stack:** TypeScript, React 19, WXT (`wxt/utils/storage`), Tailwind CSS 4, Vitest with happy-dom, `@webext-core/fake-browser`.

**Spec:** `docs/superpowers/specs/2026-08-11-drift-review-mode-design.md`

## Global Constraints

- Drift **never** writes FSRS state. No task may touch `lib/srs.ts` scheduling, `ReviewState`, or `Cloze.review`.
- Drift weights key on the word's `normalized` text, **never** on `WordEntry.id`, which `pickWordId` in `lib/sync/project.ts` can change when two replicas merge. Both kinds are namespaced — `word:${normalized}` and `quote:${id}` — so the two key spaces cannot collide.
- Drift state lives in the `local:drift` storage item. It is **not** added to the inbox, to `SyncState`, or to `materialize`'s `portableSettings`. The reason is `lib/sync/coordinator.ts:70`, which calls `setInbox(materialize(merged).inbox)` — a blind full replace, so any entry field not projected into `SyncState` is deleted on every sync pass. (Clozes used to be such a field; that was fixed separately in `9218ffa`..`837b831`, which does not change the rule.)
- `AppSettings.reviewMode` defaults to `'srs'`. Existing users see no change until they opt in.
- Drift levels are clamped to the closed range `[-2, 2]`. Nothing is ever hidden, muted, or removed from the pool.
- Every user-facing string goes in `lib/i18n.ts` under both `en` and `zh-CN`. `tests/i18n-source.test.ts` asserts full key parity and forbids `locale === 'en' ?` ternaries in `entrypoints/`.
- Component tests in this repo use raw `createRoot` + `act` from `react-dom/client`, not Testing Library. Every `.tsx` test file starts with `// @vitest-environment happy-dom`.
- Run the full suite with `npx vitest run` and typecheck with `npm run compile`. Both must pass before any commit.

---

### Task 1: Drift model (`lib/drift.ts`)

Pure functions only — no I/O, no React, no storage. This is where nearly all the logic lives, so nearly all the tests live here too.

**Files:**
- Create: `lib/drift.ts`
- Test: `tests/drift.test.ts`

**Interfaces:**
- Consumes: `Entry`, `Inbox`, `WordEntry`, `QuoteEntry` from `lib/types`.
- Produces:
  - `type DriftLevel = -2 | -1 | 0 | 1 | 2`
  - `interface DriftStore { weights: Record<string, DriftLevel>; days: Record<string, number> }`
  - `const EMPTY_DRIFT_STORE: DriftStore`
  - `const MIN_DRIFT_LEVEL: -2`, `const MAX_DRIFT_LEVEL: 2`
  - `driftKey(entry: Entry): string`
  - `clampLevel(level: number): DriftLevel`
  - `getLevel(store: DriftStore, key: string): DriftLevel`
  - `setLevel(store: DriftStore, key: string, level: DriftLevel): DriftStore`
  - `nudgeLevel(store: DriftStore, key: string, delta: 1 | -1): DriftStore`
  - `recordDriftDay(store: DriftStore, dayKey: string, delta: 1 | -1): DriftStore`
  - `buildDriftPool(inbox: Inbox): Entry[]`
  - `recentWindowSize(poolSize: number): number`
  - `pickDriftCard(pool: Entry[], store: DriftStore, recent: string[], random: () => number): Entry | null`
  - `normalizeDriftStore(value: Partial<DriftStore> | undefined | null): DriftStore`

`normalizeDriftStore` lives here rather than in the storage module so that
`lib/backup.ts` (Task 5) can import it without dragging a `wxt/utils/storage`
item definition into every backup consumer and test.

- [ ] **Step 1: Write the failing test**

Create `tests/drift.test.ts`:

```ts
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
    const store: DriftStore = { weights: { gone: 2, 'word:a': 0, 'word:b': 0 }, days: {} };
    expect(pickDriftCard(pool, store, [], seeded([0.99]))).not.toBeNull();
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/drift.test.ts
```

Expected: FAIL — `Failed to resolve import "../lib/drift"`.

- [ ] **Step 3: Write the implementation**

Create `lib/drift.ts`:

```ts
import type { Entry, Inbox } from './types';

/**
 * Drift weight, as an exponent: the draw weight is `2 ** level`, so the range
 * spans 0.25x to 4x. Bounded on purpose — a thumbed-down entry becomes rare,
 * never impossible, and a single thumb-up walks it straight back.
 */
export type DriftLevel = -2 | -1 | 0 | 1 | 2;

export const MIN_DRIFT_LEVEL = -2;
export const MAX_DRIFT_LEVEL = 2;

/** Longest run of recently-shown cards excluded from the next draw. */
export const MAX_RECENT_WINDOW = 20;

export interface DriftStore {
  /** driftKey -> level. An absent key means neutral (level 0, weight 1). */
  weights: Record<string, DriftLevel>;
  /** Local day key 'YYYY-MM-DD' -> cards drifted that day. */
  days: Record<string, number>;
}

export const EMPTY_DRIFT_STORE: DriftStore = { weights: {}, days: {} };

/**
 * Weights key on `normalized`, not on `entry.id`. `pickWordId` in
 * lib/sync/project.ts chooses a canonical id when two replicas merge the same
 * word, so a word's id can change under the user; `normalized` cannot. Both
 * kinds are prefixed so a word key can never equal a quote key.
 */
export function driftKey(entry: Entry): string {
  return entry.kind === 'word' ? `word:${entry.normalized}` : `quote:${entry.id}`;
}

export function clampLevel(level: number): DriftLevel {
  if (!Number.isFinite(level)) return 0;
  const rounded = Math.round(level);
  if (rounded <= MIN_DRIFT_LEVEL) return MIN_DRIFT_LEVEL;
  if (rounded >= MAX_DRIFT_LEVEL) return MAX_DRIFT_LEVEL;
  return rounded as DriftLevel;
}

export function getLevel(store: DriftStore, key: string): DriftLevel {
  return store.weights[key] ?? 0;
}

/** Sets an exact level. Back uses this to restore a level a clamped tap hid. */
export function setLevel(store: DriftStore, key: string, level: DriftLevel): DriftStore {
  const weights = { ...store.weights };
  if (level === 0) delete weights[key];
  else weights[key] = level;
  return { ...store, weights };
}

export function nudgeLevel(store: DriftStore, key: string, delta: 1 | -1): DriftStore {
  return setLevel(store, key, clampLevel(getLevel(store, key) + delta));
}

export function recordDriftDay(
  store: DriftStore,
  dayKey: string,
  delta: 1 | -1,
): DriftStore {
  const next = Math.max(0, (store.days[dayKey] ?? 0) + delta);
  const days = { ...store.days };
  if (next === 0) delete days[dayKey];
  else days[dayKey] = next;
  return { ...store, days };
}

/**
 * Every non-archived word and quote. Parked quotes (no clozes) are included on
 * purpose: SRS can never surface them, so Drift is their only way back.
 * Sorted by key so a seeded draw is reproducible in tests.
 */
export function buildDriftPool(inbox: Inbox): Entry[] {
  const entries: Entry[] = [
    ...inbox.words.filter((word) => word.status !== 'archived'),
    ...inbox.quotes.filter((quote) => quote.status !== 'archived'),
  ];
  return entries.sort((a, b) => driftKey(a).localeCompare(driftKey(b)));
}

/**
 * Half the pool, capped at 20. The halving guarantees the window can never
 * block every candidate, so `pickDriftCard` always has something to draw.
 */
export function recentWindowSize(poolSize: number): number {
  return Math.min(MAX_RECENT_WINDOW, Math.floor(poolSize / 2));
}

export function pickDriftCard(
  pool: Entry[],
  store: DriftStore,
  recent: string[],
  random: () => number,
): Entry | null {
  if (pool.length === 0) return null;

  const blocked = new Set(recent.slice(-recentWindowSize(pool.length)));
  const candidates = pool.filter((entry) => !blocked.has(driftKey(entry)));
  // recentWindowSize < pool.length guarantees this is non-empty; the fallback
  // is here so a caller passing a hand-built `recent` can never get null.
  const usable = candidates.length > 0 ? candidates : pool;

  let total = 0;
  const weights = usable.map((entry) => {
    const weight = 2 ** getLevel(store, driftKey(entry));
    total += weight;
    return weight;
  });

  let roll = random() * total;
  for (let i = 0; i < usable.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return usable[i];
  }
  // Float rounding can leave roll >= 0 after the loop; never return null here.
  return usable[usable.length - 1];
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pure sanitizer for anything read back from disk or restored from a backup
 * file. Lives here rather than in lib/drift-storage.ts so lib/backup.ts can use
 * it without importing a wxt storage item.
 */
export function normalizeDriftStore(
  value: Partial<DriftStore> | undefined | null,
): DriftStore {
  const weights: Record<string, DriftLevel> = {};
  for (const [key, level] of Object.entries(value?.weights ?? {})) {
    if (!key || typeof level !== 'number' || !Number.isFinite(level)) continue;
    const clamped = clampLevel(level);
    if (clamped !== 0) weights[key] = clamped;
  }

  const days: Record<string, number> = {};
  for (const [key, count] of Object.entries(value?.days ?? {})) {
    if (!DAY_KEY_PATTERN.test(key)) continue;
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue;
    days[key] = Math.floor(count);
  }

  return { weights, days };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/drift.test.ts && npm run compile
```

Expected: all tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/drift.ts tests/drift.test.ts && git commit -m "feat(drift): add pure drift weight model and weighted picker"
```

---

### Task 2: Drift persistence (`lib/drift-storage.ts`)

**Files:**
- Create: `lib/drift-storage.ts`
- Test: `tests/drift-storage.test.ts`

**Interfaces:**
- Consumes: `DriftStore`, `EMPTY_DRIFT_STORE`, `normalizeDriftStore` from `lib/drift`.
- Produces:
  - `driftStorage` (a `wxt/utils/storage` item at `local:drift`)
  - `getDriftStore(): Promise<DriftStore>`
  - `mutateDriftStore(fn: (store: DriftStore) => DriftStore): Promise<DriftStore>`
  - `replaceDriftStore(store: DriftStore): Promise<void>`
  - `watchDriftStore(listener: (store: DriftStore) => void): () => void`

- [ ] **Step 1: Write the failing test**

Create `tests/drift-storage.test.ts`:

```ts
import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { nudgeLevel, recordDriftDay } from '../lib/drift';
import {
  getDriftStore,
  mutateDriftStore,
  replaceDriftStore,
} from '../lib/drift-storage';

describe('drift storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('starts empty', async () => {
    expect(await getDriftStore()).toEqual({ weights: {}, days: {} });
  });

  it('round-trips a mutation', async () => {
    await mutateDriftStore((store) => nudgeLevel(store, '你好', 1));
    expect((await getDriftStore()).weights).toEqual({ '你好': 1 });
  });

  it('serializes concurrent mutations instead of losing one', async () => {
    await Promise.all([
      mutateDriftStore((store) => recordDriftDay(store, '2026-08-11', 1)),
      mutateDriftStore((store) => recordDriftDay(store, '2026-08-11', 1)),
      mutateDriftStore((store) => recordDriftDay(store, '2026-08-11', 1)),
    ]);
    expect((await getDriftStore()).days).toEqual({ '2026-08-11': 3 });
  });

  it('normalizes on write, so a bad value can never be persisted', async () => {
    await replaceDriftStore({ weights: { a: 99 } as never, days: {} });
    expect((await getDriftStore()).weights).toEqual({ a: 2 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/drift-storage.test.ts
```

Expected: FAIL — `Failed to resolve import "../lib/drift-storage"`.

- [ ] **Step 3: Write the implementation**

Create `lib/drift-storage.ts`:

```ts
import { storage } from 'wxt/utils/storage';
import { EMPTY_DRIFT_STORE, normalizeDriftStore, type DriftStore } from './drift';

/**
 * Drift state lives outside the inbox on purpose. lib/sync/coordinator.ts calls
 * setInbox(materialize(merged)) — a blind full replace — so any field hung off
 * an entry is destroyed on every sync pass. This item is untouched by sync.
 */
export const driftStorage = storage.defineItem<DriftStore>('local:drift', {
  fallback: EMPTY_DRIFT_STORE,
});

export async function getDriftStore(): Promise<DriftStore> {
  return normalizeDriftStore(await driftStorage.getValue());
}

/** Atomic-ish update under a simple in-process lock, mirroring mutateInbox. */
let writeChain: Promise<unknown> = Promise.resolve();

export async function mutateDriftStore(
  fn: (store: DriftStore) => DriftStore,
): Promise<DriftStore> {
  const run = writeChain
    .then(() => getDriftStore())
    .then((store) => normalizeDriftStore(fn(store)));
  writeChain = run.then((next) => driftStorage.setValue(next));
  await writeChain;
  return run;
}

export async function replaceDriftStore(store: DriftStore): Promise<void> {
  await driftStorage.setValue(normalizeDriftStore(store));
}

export function watchDriftStore(
  listener: (store: DriftStore) => void,
): () => void {
  return driftStorage.watch((next) => listener(normalizeDriftStore(next)));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/drift-storage.test.ts && npm run compile
```

Expected: all tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/drift-storage.ts tests/drift-storage.test.ts && git commit -m "feat(drift): persist drift state in a sync-safe storage item"
```

---

### Task 3: `reviewMode` app setting

**Files:**
- Modify: `lib/types.ts` (add `ReviewMode`, extend `AppSettings`)
- Modify: `lib/settings.ts` (default, normalize, setter)
- Test: `tests/settings.test.ts` (append)

**Interfaces:**
- Produces: `type ReviewMode = 'srs' | 'drift'`; `AppSettings.reviewMode: ReviewMode`; `setReviewMode(settings: AppSettings, reviewMode: ReviewMode): AppSettings`.

- [ ] **Step 1: Write the failing test**

Append to `tests/settings.test.ts` (keep the file's existing imports; add `setReviewMode` to the `../lib/settings` import list):

```ts
describe('review mode', () => {
  it('defaults to spaced repetition so existing users see no change', () => {
    expect(DEFAULT_SETTINGS.reviewMode).toBe('srs');
    expect(normalizeSettings(undefined).reviewMode).toBe('srs');
  });

  it('round-trips a drift selection', () => {
    expect(setReviewMode(DEFAULT_SETTINGS, 'drift').reviewMode).toBe('drift');
    expect(normalizeSettings({ reviewMode: 'drift' }).reviewMode).toBe('drift');
  });

  it('falls back to srs for an unrecognized stored value', () => {
    expect(normalizeSettings({ reviewMode: 'nonsense' } as never).reviewMode).toBe('srs');
  });

  it('leaves the other settings blocks untouched', () => {
    const next = setReviewMode(DEFAULT_SETTINGS, 'drift');
    expect(next.srs).toEqual(DEFAULT_SETTINGS.srs);
    expect(next.uiLocale).toBe(DEFAULT_SETTINGS.uiLocale);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/settings.test.ts
```

Expected: FAIL — `setReviewMode` is not exported.

- [ ] **Step 3: Write the implementation**

In `lib/types.ts`, add above `export interface AppSettings`:

```ts
/** Which review experience the dashboard's Review tab renders. */
export type ReviewMode = 'srs' | 'drift';
```

and add the field to `AppSettings`:

```ts
export interface AppSettings {
  uiLocale: UiLocale;
  reviewMode: ReviewMode;
  kaikki: KaikkiSettings;
  cvdict: CvdictSettings;
  srs: SrsSettings;
}
```

In `lib/settings.ts`, add `ReviewMode` to the type import from `./types`, then:

```ts
export const DEFAULT_SETTINGS: AppSettings = {
  uiLocale: 'zh-CN',
  reviewMode: 'srs',
  kaikki: DEFAULT_KAIKKI_SETTINGS,
  cvdict: DEFAULT_CVDICT_SETTINGS,
  srs: DEFAULT_SRS_SETTINGS,
};
```

Add the setter next to `setUiLocale`:

```ts
export function setReviewMode(
  settings: AppSettings,
  reviewMode: ReviewMode,
): AppSettings {
  return { ...settings, reviewMode };
}
```

And in `normalizeSettings`, add the field to the returned object:

```ts
    uiLocale: value?.uiLocale ?? DEFAULT_SETTINGS.uiLocale,
    reviewMode: value?.reviewMode === 'drift' ? 'drift' : 'srs',
```

Note: `reviewMode` is deliberately **not** added to `materialize`'s `portableSettings` in `lib/sync/project.ts`. The sync coordinator writes `replaceSettings({ ...current, uiLocale, srs, kaikki })`, so spreading `current` preserves it — the mode stays per-device, matching the CVDICT decision.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run && npm run compile
```

Expected: full suite PASS. If any test constructs an `AppSettings` literal by hand, add `reviewMode: 'srs'` to it — the typecheck will name each file.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/settings.ts tests/settings.test.ts && git commit -m "feat(drift): add per-device reviewMode setting defaulting to srs"
```

---

### Task 4: Drift days in review stats

**Files:**
- Modify: `lib/review-stats.ts` (`DayCount`, `ReviewStats`, `computeReviewStats`)
- Test: `tests/review-stats.test.ts` (append)

**Interfaces:**
- Consumes: `DriftStore['days']` shape (`Record<string, number>`) — passed as a plain record, so `lib/review-stats.ts` does not import from `lib/drift` and stays dependency-free.
- Produces: `computeReviewStats(inbox, now?, driftDays?)`; `DayCount.driftCount?: number`; `ReviewStats.driftedToday: number`; `ReviewStats.totalDrifted: number`.

`buildHeatmap` and `computeStreak` keep their current signatures — the union map is built by `computeReviewStats` before calling them, and `driftCount` is decorated onto the heatmap cells afterwards.

- [ ] **Step 1: Write the failing test**

Append to `tests/review-stats.test.ts` (add `computeReviewStats` to the imports from `../lib/review-stats` if it is not already there):

```ts
describe('drift days in review stats', () => {
  const now = new Date('2026-08-11T10:00:00').getTime();
  const empty = { words: [], quotes: [] };

  it('defaults driftDays so existing callers are unaffected', () => {
    const stats = computeReviewStats(empty, now);
    expect(stats.driftedToday).toBe(0);
    expect(stats.totalDrifted).toBe(0);
  });

  it('counts a drift-only day as an active day for the streak', () => {
    const stats = computeReviewStats(empty, now, {
      '2026-08-09': 4,
      '2026-08-10': 2,
      '2026-08-11': 7,
    });
    expect(stats.currentStreak).toBe(3);
  });

  it('lets a drift day bridge the one-day grace gap between review days', () => {
    // No reviews at all; days 08-07 and 08-09 drifted, 08-08 skipped.
    const stats = computeReviewStats(empty, now, {
      '2026-08-07': 1,
      '2026-08-09': 1,
      '2026-08-11': 1,
    });
    expect(stats.currentStreak).toBe(3);
  });

  it('reports today drift count separately from reviews', () => {
    const stats = computeReviewStats(empty, now, { '2026-08-11': 5 });
    expect(stats.driftedToday).toBe(5);
    expect(stats.reviewedToday).toBe(0);
  });

  it('never inflates lifetime reviews with drift', () => {
    const stats = computeReviewStats(empty, now, { '2026-08-11': 40 });
    expect(stats.totalReviews).toBe(0);
    expect(stats.totalDrifted).toBe(40);
  });

  it('keeps heatmap count review-only and exposes drift separately', () => {
    const stats = computeReviewStats(empty, now, { '2026-08-11': 6 });
    const today = stats.heatmap[stats.heatmap.length - 1];
    expect(today.date).toBe('2026-08-11');
    expect(today.count).toBe(0);
    expect(today.driftCount).toBe(6);
  });

  it('ignores drift days outside the heatmap window without throwing', () => {
    const stats = computeReviewStats(empty, now, { '2020-01-01': 3 });
    expect(stats.heatmap.every((cell) => (cell.driftCount ?? 0) === 0)).toBe(true);
    expect(stats.totalDrifted).toBe(3);
  });

  it('leaves the forecast untouched', () => {
    const stats = computeReviewStats(empty, now, { '2026-08-11': 9 });
    expect(stats.forecast.every((cell) => cell.count === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/review-stats.test.ts
```

Expected: FAIL — `computeReviewStats` takes 2 arguments; `driftedToday` is undefined.

- [ ] **Step 3: Write the implementation**

In `lib/review-stats.ts`, extend `DayCount`:

```ts
export interface DayCount {
  /** Local calendar day, 'YYYY-MM-DD'. */
  date: string;
  count: number;
  /** Heatmap only: cards drifted that day. Absent on forecast buckets. */
  driftCount?: number;
}
```

Extend `ReviewStats` with two fields (place them next to `reviewedToday` and `totalReviews`):

```ts
  /** Cards drifted today (local). Never folded into reviewedToday. */
  driftedToday: number;
  /** Lifetime cards drifted. Never folded into totalReviews. */
  totalDrifted: number;
```

Replace `computeReviewStats` with:

```ts
export function computeReviewStats(
  inbox: Inbox,
  now = Date.now(),
  driftDays: Record<string, number> = {},
): ReviewStats {
  const states = collectReviewStates(inbox);
  const dayCounts = reviewDayCounts(states);
  const today = localDayKey(now);

  // The streak treats a drift day as an active day: showing up at all keeps it
  // alive. The counts are summed only so the map is honest; computeStreak reads
  // keys, not values.
  const activeDays = new Map(dayCounts);
  let totalDrifted = 0;
  for (const [day, count] of Object.entries(driftDays)) {
    if (count <= 0) continue;
    totalDrifted += count;
    activeDays.set(day, (activeDays.get(day) ?? 0) + count);
  }

  const { current, longest, state } = computeStreak(activeDays, today);

  let totalReviews = 0;
  for (const s of states) totalReviews += s.reviewLog?.length ?? 0;

  return {
    totalReviews,
    totalDrifted,
    currentStreak: current,
    longestStreak: longest,
    streakState: state,
    reviewedToday: dayCounts.get(today) ?? 0,
    driftedToday: driftDays[today] ?? 0,
    // `count` stays review-only; drift rides alongside so the heatmap can show
    // both without buildHeatmap needing to know drift exists.
    heatmap: buildHeatmap(dayCounts, now, HEATMAP_DAYS).map((cell) => ({
      ...cell,
      driftCount: driftDays[cell.date] ?? 0,
    })),
    forecast: buildForecast(states, now, FORECAST_DAYS),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run && npm run compile
```

Expected: full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/review-stats.ts tests/review-stats.test.ts && git commit -m "feat(drift): let drift days keep the review streak alive"
```

---

### Task 5: Full backup format version 4

The version bump is the risky part: `restoreFullBackup` currently detects a full backup with a strict `=== FULL_BACKUP_FORMAT_VERSION`, so bumping the constant alone would push every existing v3 file into the inbox-only fallback and silently drop the user's settings and API key. The check must accept 3 **or** 4.

**Files:**
- Modify: `lib/backup.ts:341-430`
- Modify: `entrypoints/dashboard/components/Toolbar.tsx:80` (pass drift to the serializer)
- Test: `tests/sync/backup-full.test.ts` (append)

**Interfaces:**
- Consumes: `DriftStore`, `EMPTY_DRIFT_STORE`, `normalizeDriftStore` — all from `lib/drift`, which is pure, so `lib/backup.ts` gains no storage dependency.
- Produces:
  - `FULL_BACKUP_FORMAT_VERSION = 4`
  - `FullBackup.drift: DriftStore`
  - `createFullBackup(inbox, settings, aiSettings, drift?, exportedAt?)`
  - `serializeFullBackup(inbox, settings, aiSettings, drift?, exportedAt?)`
  - `restoreFullBackup(raw): { inbox: Inbox; settings?: AppSettings; aiSettings?: AiSettings; drift: DriftStore }`

- [ ] **Step 1: Write the failing test**

Append to `tests/sync/backup-full.test.ts`:

```ts
describe('drift in the full backup', () => {
  const drift = { weights: { '你好': 2 as const }, days: { '2026-08-11': 5 } };

  it('round-trips drift state at v4', () => {
    const raw = serializeFullBackup(EMPTY_INBOX, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, drift);
    expect(JSON.parse(raw).formatVersion).toBe(4);
    expect(restoreFullBackup(raw).drift).toEqual(drift);
  });

  it('still restores a v3 backup WITH its settings and API key', () => {
    // The regression guard: a naive version bump sends v3 down the inbox-only
    // fallback and silently drops settings + aiSettings.
    const v3 = JSON.stringify({
      app: 'shiyu-hanzi-box',
      formatVersion: 3,
      exportedAt: '2026-07-01T00:00:00.000Z',
      inbox: EMPTY_INBOX,
      settings: DEFAULT_SETTINGS,
      aiSettings: { ...DEFAULT_AI_SETTINGS, apiKey: 'sk-secret' },
    });
    const out = restoreFullBackup(v3);
    expect(out.settings).toBeDefined();
    expect(out.aiSettings?.apiKey).toBe('sk-secret');
    expect(out.drift).toEqual({ weights: {}, days: {} });
  });

  it('keeps the v3 error message wording for a malformed v3 inbox', () => {
    const raw = JSON.stringify({ app: 'shiyu-hanzi-box', formatVersion: 3, inbox: 'nope' });
    expect(() => restoreFullBackup(raw)).toThrow('Invalid v3 backup: inbox is malformed.');
  });

  it('reports v4 in the error message for a malformed v4 inbox', () => {
    const raw = JSON.stringify({ app: 'shiyu-hanzi-box', formatVersion: 4, inbox: 'nope' });
    expect(() => restoreFullBackup(raw)).toThrow('Invalid v4 backup: inbox is malformed.');
  });

  it('normalizes hostile drift values instead of trusting the file', () => {
    const raw = JSON.stringify({
      app: 'shiyu-hanzi-box',
      formatVersion: 4,
      inbox: EMPTY_INBOX,
      drift: { weights: { a: 999 }, days: { nope: 3 } },
    });
    expect(restoreFullBackup(raw).drift).toEqual({ weights: { a: 2 }, days: {} });
  });

  it('defaults drift to empty when the key is absent from a v4 file', () => {
    const raw = JSON.stringify({
      app: 'shiyu-hanzi-box',
      formatVersion: 4,
      inbox: EMPTY_INBOX,
    });
    expect(restoreFullBackup(raw).drift).toEqual({ weights: {}, days: {} });
  });

  it('defaults drift to empty for an inbox-only v2 backup', () => {
    const raw = JSON.stringify({ app: 'shiyu-hanzi-box', formatVersion: 2, inbox: EMPTY_INBOX });
    expect(restoreFullBackup(raw).drift).toEqual({ weights: {}, days: {} });
  });
});
```

`DEFAULT_SETTINGS`, `DEFAULT_AI_SETTINGS`, `EMPTY_INBOX`, `serializeFullBackup`, and `restoreFullBackup` are already imported at the top of this file — no import changes needed.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/sync/backup-full.test.ts
```

Expected: FAIL — `formatVersion` is 3, and `restoreFullBackup(...).drift` is undefined.

- [ ] **Step 3: Write the implementation**

In `lib/backup.ts`, add to the imports:

```ts
import { EMPTY_DRIFT_STORE, type DriftStore } from './drift';
import { normalizeDriftStore } from './drift-storage';
```

Replace the full-backup block (from `export const FULL_BACKUP_FORMAT_VERSION` through the end of `restoreFullBackup`) with:

```ts
export const FULL_BACKUP_FORMAT_VERSION = 4 as const;

/**
 * v3 files are still first-class. The detection below must accept both — a
 * strict === on the current constant would send every v3 backup down the
 * inbox-only fallback and silently drop the user's settings and API key.
 */
const SUPPORTED_FULL_BACKUP_VERSIONS: readonly number[] = [3, 4];

export interface FullBackup {
  app: typeof BACKUP_APP;
  formatVersion: typeof FULL_BACKUP_FORMAT_VERSION;
  exportedAt: string;
  inbox: Inbox;
  settings: AppSettings;
  aiSettings: AiSettings;
  /** Added in v4. Absent in v3 files, which restore as an empty store. */
  drift: DriftStore;
}

export function createFullBackup(
  inbox: Inbox,
  settings: AppSettings,
  aiSettings: AiSettings,
  drift: DriftStore = EMPTY_DRIFT_STORE,
  exportedAt = new Date(),
): FullBackup {
  return {
    app: BACKUP_APP,
    formatVersion: FULL_BACKUP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    inbox: cloneInbox(inbox),
    settings,
    aiSettings,
    drift: normalizeDriftStore(drift),
  };
}

export function serializeFullBackup(
  inbox: Inbox,
  settings: AppSettings,
  aiSettings: AiSettings,
  drift: DriftStore = EMPTY_DRIFT_STORE,
  exportedAt = new Date(),
): string {
  return `${JSON.stringify(
    createFullBackup(inbox, settings, aiSettings, drift, exportedAt),
    null,
    2,
  )}\n`;
}

function isAppSettings(value: unknown): value is AppSettings {
  return (
    isRecord(value) &&
    isString((value as Record<string, unknown>).uiLocale) &&
    isRecord((value as Record<string, unknown>).srs) &&
    isRecord((value as Record<string, unknown>).kaikki)
  );
}

function isAiSettings(value: unknown): value is AiSettings {
  return (
    isRecord(value) &&
    typeof (value as Record<string, unknown>).enabled === 'boolean' &&
    isString((value as Record<string, unknown>).provider) &&
    isString((value as Record<string, unknown>).baseUrl) &&
    isString((value as Record<string, unknown>).apiKey) &&
    isString((value as Record<string, unknown>).model)
  );
}

export function restoreFullBackup(raw: string): {
  inbox: Inbox;
  settings?: AppSettings;
  aiSettings?: AiSettings;
  drift: DriftStore;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupParseError('Backup file is not valid JSON.');
  }

  const value = parsed as Record<string, unknown>;
  const version = value?.formatVersion;
  if (typeof version === 'number' && SUPPORTED_FULL_BACKUP_VERSIONS.includes(version)) {
    if (!isInbox(value.inbox)) {
      throw new BackupParseError(`Invalid v${version} backup: inbox is malformed.`);
    }
    if (value.settings !== undefined && !isAppSettings(value.settings)) {
      throw new BackupParseError(`Invalid v${version} backup: settings is malformed.`);
    }
    if (value.aiSettings !== undefined && !isAiSettings(value.aiSettings)) {
      throw new BackupParseError(`Invalid v${version} backup: aiSettings is malformed.`);
    }
    return {
      inbox: cloneInbox(value.inbox as Inbox),
      settings: value.settings as AppSettings | undefined,
      aiSettings: value.aiSettings as AiSettings | undefined,
      // Peer-supplied and untrusted — normalize rather than cast.
      drift: isRecord(value.drift)
        ? normalizeDriftStore(value.drift as Partial<DriftStore>)
        : EMPTY_DRIFT_STORE,
    };
  }
  // Fallback: inbox-only backup (formatVersion 2 or lower); settings/AI absent.
  return { inbox: parseBackup(raw), drift: EMPTY_DRIFT_STORE };
}
```

The inbox-only backup (format version 2) is unchanged — drift is not inbox data.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/sync/backup-full.test.ts && npm run compile
```

Expected: PASS. `npm run compile` will flag `Toolbar.tsx:80` only if drift is passed there — it is not yet, and the parameter defaults, so the build stays green. Toolbar is wired in Task 10.

- [ ] **Step 5: Commit**

```bash
git add lib/backup.ts tests/sync/backup-full.test.ts && git commit -m "feat(drift): carry drift state in full backup v4, keeping v3 restorable"
```

---

### Task 6: Localized strings

All Drift copy lands here in one pass so later UI tasks only consume keys. `tests/i18n-source.test.ts` asserts `en` and `zh-CN` are at full key parity, so both tables must be edited together.

**Files:**
- Modify: `lib/i18n.ts` (both the `en` and `zh-CN` tables)
- Test: `tests/i18n.test.ts` (append)

**Interfaces:**
- Produces these `MessageKey`s: `drift.title`, `drift.seeMore`, `drift.seeLess`, `drift.skip`, `drift.back`, `drift.emptyTitle`, `drift.emptyBody`, `drift.weightLabel`, `drift.weightDot`, `settings.reviewMode`, `settings.reviewModeHint`, `settings.modeSrs`, `settings.modeSrsHint`, `settings.modeDrift`, `settings.modeDriftHint`, `stats.driftedToday`, `stats.totalDrifted`, `stats.legendDrift`, `stats.heatmapCellDrift`.

- [ ] **Step 1: Write the failing test**

Append to `tests/i18n.test.ts`:

```ts
describe('drift strings', () => {
  const keys = [
    'drift.title',
    'drift.seeMore',
    'drift.seeLess',
    'drift.skip',
    'drift.back',
    'drift.emptyTitle',
    'drift.emptyBody',
    'drift.weightLabel',
    'drift.weightDot',
    'settings.reviewMode',
    'settings.reviewModeHint',
    'settings.modeSrs',
    'settings.modeSrsHint',
    'settings.modeDrift',
    'settings.modeDriftHint',
    'stats.driftedToday',
    'stats.totalDrifted',
    'stats.legendDrift',
    'stats.heatmapCellDrift',
  ] as const;

  it('defines every drift key in both locales', () => {
    for (const key of keys) {
      expect(messages.en).toHaveProperty(key);
      expect(messages['zh-CN']).toHaveProperty(key);
    }
  });

  it('interpolates the drift heatmap tooltip', () => {
    expect(formatMessage('en', 'stats.heatmapCellDrift', { date: '2026-08-11', n: 3, d: 7 }))
      .toContain('2026-08-11');
    expect(formatMessage('en', 'stats.heatmapCellDrift', { date: '2026-08-11', n: 3, d: 7 }))
      .toContain('7');
  });

  it('interpolates the lifetime drift figure in both locales', () => {
    expect(formatMessage('en', 'stats.totalDrifted', { n: '1,234' })).toContain('1,234');
    expect(formatMessage('zh-CN', 'stats.totalDrifted', { n: '1,234' })).toContain('1,234');
  });
});
```

Ensure `formatMessage` and `messages` are imported at the top of the file (`import { formatMessage, messages } from '../lib/i18n';`).

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/i18n.test.ts
```

Expected: FAIL — the drift keys are missing from both tables.

- [ ] **Step 3: Write the implementation**

In `lib/i18n.ts`, add to the `en` table immediately after the `'review.*'` block:

```ts
    'drift.title': 'Drift',
    'drift.seeMore': 'See more',
    'drift.seeLess': 'See less',
    'drift.skip': 'Skip',
    'drift.back': 'Back',
    'drift.emptyTitle': 'Nothing to drift through yet',
    'drift.emptyBody': 'Save a word or a quote while you read, and it will surface here.',
    'drift.weightLabel': 'How often this comes back',
    'drift.weightDot': 'Level {n} of 5',
```

Add to the `en` table after the existing `'settings.srs*'` keys:

```ts
    'settings.reviewMode': 'Review mode',
    'settings.reviewModeHint': 'Both modes read the same collection. Switching is safe — nothing is rescheduled or lost.',
    'settings.modeSrs': 'Spaced repetition',
    'settings.modeSrsHint': 'Grade each card; FSRS decides when you see it again.',
    'settings.modeDrift': 'Drift (漫读)',
    'settings.modeDriftHint': 'Browse words and quotes at random, nothing hidden. Thumbs shape what comes back.',
```

Add to the `en` table after `'stats.heatmapCell'`:

```ts
    'stats.driftedToday': '{n} drifted today',
    'stats.totalDrifted': '{n} cards drifted all-time',
    'stats.legendDrift': 'Outlined cells are drift-only days',
    'stats.heatmapCellDrift': '{date}: {n} reviews · {d} drifted',
```

Add the matching keys to the `zh-CN` table in the same positions:

```ts
    'drift.title': '漫读',
    'drift.seeMore': '多看看',
    'drift.seeLess': '少看点',
    'drift.skip': '跳过',
    'drift.back': '上一张',
    'drift.emptyTitle': '还没有可以漫读的内容',
    'drift.emptyBody': '阅读时收下一个词或一句话，它就会出现在这里。',
    'drift.weightLabel': '再次出现的频率',
    'drift.weightDot': '第 {n} 档，共 5 档',
```

```ts
    'settings.reviewMode': '复习模式',
    'settings.reviewModeHint': '两种模式读取同一份收藏。随时切换都不会重排进度，也不会丢失数据。',
    'settings.modeSrs': '间隔重复',
    'settings.modeSrsHint': '为每张卡片评分，由 FSRS 决定下次出现的时间。',
    'settings.modeDrift': '漫读',
    'settings.modeDriftHint': '随机浏览词语和句子，内容全部展开。用大拇指调整它们再次出现的频率。',
```

```ts
    'stats.driftedToday': '今天漫读 {n} 张',
    'stats.totalDrifted': '累计漫读 {n} 张',
    'stats.legendDrift': '描边格子表示只漫读的日子',
    'stats.heatmapCellDrift': '{date}：复习 {n} 张 · 漫读 {d} 张',
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/i18n.test.ts tests/i18n-source.test.ts && npm run compile
```

Expected: PASS, including the `en`/`zh-CN` key parity assertion.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts tests/i18n.test.ts && git commit -m "feat(drift): add English and zh-CN strings for drift mode"
```

---

### Task 7: `useDrift` hook

**Files:**
- Create: `entrypoints/dashboard/hooks/useDrift.ts`
- Test: `tests/use-drift.test.tsx`

**Interfaces:**
- Consumes: `getDriftStore`, `watchDriftStore`, `mutateDriftStore` from `lib/drift-storage`.
- Produces: `useDrift(): { driftStore: DriftStore; loading: boolean; mutateDrift: (fn: (store: DriftStore) => DriftStore) => Promise<void> }`.

Note this hook does **not** go through `requestSyncMutation` — drift state is outside the sync domain entirely.

- [ ] **Step 1: Write the failing test**

Create `tests/use-drift.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { fakeBrowser } from '@webext-core/fake-browser';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDrift } from '../entrypoints/dashboard/hooks/useDrift';
import { nudgeLevel } from '../lib/drift';
import { replaceDriftStore } from '../lib/drift-storage';

let container: HTMLDivElement;
let root: Root;

function Probe({ onRender }: { onRender: (state: ReturnType<typeof useDrift>) => void }) {
  onRender(useDrift());
  return null;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fakeBrowser.reset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('useDrift', () => {
  it('loads the persisted store', async () => {
    await replaceDriftStore({ weights: { '你好': 2 }, days: {} });

    let latest: ReturnType<typeof useDrift> | null = null;
    await act(async () => {
      root.render(<Probe onRender={(state) => { latest = state; }} />);
    });

    expect(latest!.loading).toBe(false);
    expect(latest!.driftStore.weights).toEqual({ '你好': 2 });
  });

  it('writes a mutation through to storage', async () => {
    let latest: ReturnType<typeof useDrift> | null = null;
    await act(async () => {
      root.render(<Probe onRender={(state) => { latest = state; }} />);
    });

    await act(async () => {
      await latest!.mutateDrift((store) => nudgeLevel(store, '你好', 1));
    });

    expect(latest!.driftStore.weights).toEqual({ '你好': 1 });
  });

  it('picks up an external write via the storage watcher', async () => {
    let latest: ReturnType<typeof useDrift> | null = null;
    await act(async () => {
      root.render(<Probe onRender={(state) => { latest = state; }} />);
    });

    await act(async () => {
      await replaceDriftStore({ weights: {}, days: { '2026-08-11': 3 } });
    });

    expect(latest!.driftStore.days).toEqual({ '2026-08-11': 3 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/use-drift.test.tsx
```

Expected: FAIL — cannot resolve `useDrift`.

- [ ] **Step 3: Write the implementation**

Create `entrypoints/dashboard/hooks/useDrift.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { EMPTY_DRIFT_STORE, type DriftStore } from '@/lib/drift';
import { getDriftStore, mutateDriftStore, watchDriftStore } from '@/lib/drift-storage';

/**
 * Drift state is outside the sync domain, so this hook writes storage directly
 * rather than going through requestSyncMutation like useSettings does.
 */
export function useDrift() {
  const [driftStore, setDriftStore] = useState<DriftStore>(EMPTY_DRIFT_STORE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    void getDriftStore().then((value) => {
      if (!mounted) return;
      setDriftStore(value);
      setLoading(false);
    });
    const unwatch = watchDriftStore((next) => {
      if (mounted) setDriftStore(next);
    });
    return () => {
      mounted = false;
      unwatch();
    };
  }, []);

  const mutateDrift = useCallback(async (fn: (store: DriftStore) => DriftStore) => {
    const next = await mutateDriftStore(fn);
    setDriftStore(next);
  }, []);

  return { driftStore, loading, mutateDrift };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/use-drift.test.tsx && npm run compile
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/dashboard/hooks/useDrift.ts tests/use-drift.test.tsx && git commit -m "feat(drift): add useDrift hook for reading and writing drift state"
```

---

### Task 8: `DriftView` and `DriftCard`

One file holding the stateful view and the presentational card, mirroring how `ReviewQueue.tsx` splits `ReviewQueue` and `ReviewCard`.

The Back button restores the **exact previous level** rather than applying an inverse nudge — an inverse nudge would corrupt a tap that was clamped at a bound (thumb-up at level 2 is a no-op, but `-1` from it would land on 1).

**Files:**
- Create: `entrypoints/dashboard/components/DriftView.tsx`
- Test: `tests/drift-view.test.tsx`

**Interfaces:**
- Consumes: `buildDriftPool`, `pickDriftCard`, `driftKey`, `getLevel`, `recentWindowSize`, `type DriftLevel`, `type DriftStore` from `lib/drift`; `ReviewInsightReveal`, `SpeakButton` from sibling components; `toPinyin` from `lib/pinyin`; `localDayKey` from `lib/srs`.
- Produces:
  - `DriftView(props)` where props are:
    ```ts
    {
      inbox: Inbox;
      store: DriftStore;
      onThumb: (entry: Entry, delta: 1 | -1, previousLevel: DriftLevel, dayKey: string) => void | Promise<void>;
      onSkip: (dayKey: string) => void | Promise<void>;
      onBack: (entry: Entry, previousLevel: DriftLevel, dayKey: string) => void | Promise<void>;
      locale: UiLocale;
      dictionaryCacheKey?: string;
      dictionarySettings?: AppSettings;
      random?: () => number;
      now?: () => number;
    }
    ```
  - `DriftCard(props)` — presentational, exported for tests.

- [ ] **Step 1: Write the failing test**

Create `tests/drift-view.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriftView } from '../entrypoints/dashboard/components/DriftView';
import { EMPTY_DRIFT_STORE } from '../lib/drift';
import { messages } from '../lib/i18n';
import type { Inbox, QuoteEntry, WordEntry } from '../lib/types';

const NOW = new Date('2026-08-11T10:00:00').getTime();

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
    tags: ['论语'],
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    sourceTitle: 'Analects',
    sourceUrl: 'https://example.com/a',
    sourceDomain: 'example.com',
    surrounding: '',
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function render(inbox: Inbox, handlers: Record<string, unknown> = {}) {
  act(() => {
    root.render(
      <DriftView
        inbox={inbox}
        store={EMPTY_DRIFT_STORE}
        onThumb={() => {}}
        onSkip={() => {}}
        onBack={() => {}}
        locale="en"
        random={() => 0}
        now={() => NOW}
        {...handlers}
      />,
    );
  });
}

function click(testId: string) {
  act(() => {
    container
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('DriftView', () => {
  it('shows the empty state when nothing is collectable', () => {
    render({ words: [], quotes: [] });
    expect(container.textContent).toContain(messages.en['drift.emptyTitle']);
  });

  it('excludes archived entries from the pool', () => {
    render({ words: [word({ status: 'archived' })], quotes: [] });
    expect(container.textContent).toContain(messages.en['drift.emptyTitle']);
  });

  it('shows a parked quote, which SRS can never surface', () => {
    render({ words: [], quotes: [quote({ clozes: [] })] });
    expect(container.textContent).toContain('学而时习之');
  });

  it('renders a quote with no cloze blanks', () => {
    render({
      words: [],
      quotes: [quote({ clozes: [{ id: 'c1', start: 0, end: 2 }] })],
    });
    // The full sentence, not a blanked one.
    expect(container.textContent).toContain('学而时习之');
    expect(container.textContent).not.toContain('____');
  });

  it('offers all three controls plus back', () => {
    render({ words: [word()], quotes: [] });
    for (const id of ['drift-down', 'drift-skip', 'drift-up']) {
      expect(container.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
  });

  it('reports a thumb-up with its previous level and local day', () => {
    const onThumb = vi.fn();
    render({ words: [word()], quotes: [] }, { onThumb });
    click('drift-up');
    expect(onThumb).toHaveBeenCalledWith(
      expect.objectContaining({ normalized: '你好' }),
      1,
      0,
      '2026-08-11',
    );
  });

  it('reports a thumb-down as delta -1', () => {
    const onThumb = vi.fn();
    render({ words: [word()], quotes: [] }, { onThumb });
    click('drift-down');
    expect(onThumb).toHaveBeenCalledWith(expect.anything(), -1, 0, '2026-08-11');
  });

  it('records a skip without a weight change', () => {
    const onSkip = vi.fn();
    const onThumb = vi.fn();
    render({ words: [word()], quotes: [] }, { onSkip, onThumb });
    click('drift-skip');
    expect(onSkip).toHaveBeenCalledWith('2026-08-11');
    expect(onThumb).not.toHaveBeenCalled();
  });

  it('advances to a different card after a thumb', () => {
    // Distinct text per word — two entries both reading 你好 would make this
    // assertion pass or fail for the wrong reason.
    render({ words: [word({ id: 'wa', normalized: 'a', text: '甲' }), word({ id: 'wb', normalized: 'b', text: '乙' })], quotes: [] });
    expect(container.querySelector('[data-testid="drift-text"]')!.textContent).toBe('甲');
    click('drift-up');
    expect(container.querySelector('[data-testid="drift-text"]')!.textContent).toBe('乙');
  });

  it('hides Back on the first card', () => {
    render({ words: [word()], quotes: [] });
    expect(container.querySelector('[data-testid="drift-back"]')).toBeNull();
  });

  it('returns to the previous card and reports the level to restore', () => {
    const onBack = vi.fn();
    render(
      { words: [word({ id: 'wa', normalized: 'a', text: '甲' }), word({ id: 'wb', normalized: 'b', text: '乙' })], quotes: [] },
      { onBack },
    );
    click('drift-up');
    click('drift-back');
    expect(container.querySelector('[data-testid="drift-text"]')!.textContent).toBe('甲');
    expect(onBack).toHaveBeenCalledWith(expect.anything(), 0, '2026-08-11');
  });

  it('renders a five-dot weight scale', () => {
    render({ words: [word()], quotes: [] });
    expect(container.querySelectorAll('[data-testid="drift-dot"]')).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/drift-view.test.tsx
```

Expected: FAIL — cannot resolve `DriftView`.

- [ ] **Step 3: Write the implementation**

Create `entrypoints/dashboard/components/DriftView.tsx`:

```tsx
import { ThumbsDown, ThumbsUp, SkipForward, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  buildDriftPool,
  driftKey,
  getLevel,
  pickDriftCard,
  recentWindowSize,
  MAX_DRIFT_LEVEL,
  MIN_DRIFT_LEVEL,
  type DriftLevel,
  type DriftStore,
} from '@/lib/drift';
import { formatMessage, t } from '@/lib/i18n';
import { toPinyin } from '@/lib/pinyin';
import { localDayKey } from '@/lib/srs';
import type { AppSettings, Entry, QuoteEntry, UiLocale, WordEntry } from '@/lib/types';
import { ReviewInsightReveal } from './ReviewInsightReveal';
import { SpeakButton } from './SpeakButton';

/** What Back needs to fully undo one advance. */
interface DriftHistoryItem {
  entry: Entry;
  /** The level before the tap. Restored verbatim, so clamped taps undo correctly. */
  previousLevel: DriftLevel;
  /** The local day the advance was counted on, so a session across midnight undoes the right one. */
  dayKey: string;
}

export function DriftView({
  inbox,
  store,
  onThumb,
  onSkip,
  onBack,
  locale,
  dictionaryCacheKey = 'default',
  dictionarySettings,
  random = Math.random,
  now = Date.now,
}: {
  inbox: { words: WordEntry[]; quotes: QuoteEntry[] };
  store: DriftStore;
  onThumb: (
    entry: Entry,
    delta: 1 | -1,
    previousLevel: DriftLevel,
    dayKey: string,
  ) => void | Promise<void>;
  onSkip: (dayKey: string) => void | Promise<void>;
  onBack: (entry: Entry, previousLevel: DriftLevel, dayKey: string) => void | Promise<void>;
  locale: UiLocale;
  dictionaryCacheKey?: string;
  dictionarySettings?: AppSettings;
  random?: () => number;
  now?: () => number;
}) {
  const pool = useMemo(() => buildDriftPool(inbox), [inbox]);

  const [current, setCurrent] = useState<Entry | null>(() =>
    pickDriftCard(pool, store, [], random),
  );
  const [recent, setRecent] = useState<string[]>([]);
  const [history, setHistory] = useState<DriftHistoryItem[]>([]);

  // The pool can change under us (an entry archived in another tab). Fall back
  // deterministically rather than drawing during render — calling the RNG in
  // render would pick a different card on every re-render.
  const currentKey = current ? driftKey(current) : null;
  const inPool = currentKey !== null && pool.some((entry) => driftKey(entry) === currentKey);
  const active = inPool ? current : (pool[0] ?? null);

  if (pool.length === 0 || !active) {
    return (
      <div className="rounded-2xl border border-border bg-card-soft p-10 text-center shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
        <p className="text-base text-ink">{t(locale, 'drift.emptyTitle')}</p>
        <p className="mt-2 text-sm text-muted">{t(locale, 'drift.emptyBody')}</p>
      </div>
    );
  }

  function advance(item: DriftHistoryItem) {
    const key = driftKey(item.entry);
    const nextRecent = [...recent, key].slice(-Math.max(1, recentWindowSize(pool.length)));
    setRecent(nextRecent);
    setHistory((prev) => [...prev, item]);
    setCurrent(pickDriftCard(pool, store, nextRecent, random));
  }

  function thumb(delta: 1 | -1) {
    const dayKey = localDayKey(now());
    const previousLevel = getLevel(store, driftKey(active!));
    void onThumb(active!, delta, previousLevel, dayKey);
    advance({ entry: active!, previousLevel, dayKey });
  }

  function skip() {
    const dayKey = localDayKey(now());
    void onSkip(dayKey);
    advance({ entry: active!, previousLevel: getLevel(store, driftKey(active!)), dayKey });
  }

  function back() {
    const last = history[history.length - 1];
    if (!last) return;
    void onBack(last.entry, last.previousLevel, last.dayKey);
    setHistory((prev) => prev.slice(0, -1));
    setRecent((prev) => prev.slice(0, -1));
    setCurrent(last.entry);
  }

  return (
    <div className="space-y-3">
      <DriftCard
        entry={active}
        level={getLevel(store, driftKey(active))}
        locale={locale}
        dictionaryCacheKey={dictionaryCacheKey}
        dictionarySettings={dictionarySettings}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
        {history.length > 0 ? (
          <button
            data-testid="drift-back"
            onClick={back}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted transition hover:text-ink-secondary"
          >
            <Undo2 className="h-4 w-4" />
            {t(locale, 'drift.back')}
          </button>
        ) : (
          <span />
        )}

        <div className="inline-flex gap-2">
          <button
            data-testid="drift-down"
            onClick={() => thumb(-1)}
            title={t(locale, 'drift.seeLess')}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card-soft px-4 py-1.5 text-sm text-ink-secondary transition hover:border-accent-fade"
          >
            <ThumbsDown className="h-4 w-4" />
            {t(locale, 'drift.seeLess')}
          </button>
          <button
            data-testid="drift-skip"
            onClick={skip}
            title={t(locale, 'drift.skip')}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm text-muted transition hover:text-ink-secondary"
          >
            <SkipForward className="h-4 w-4" />
            {t(locale, 'drift.skip')}
          </button>
          <button
            data-testid="drift-up"
            onClick={() => thumb(1)}
            title={t(locale, 'drift.seeMore')}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent shadow-sm transition hover:bg-accent-deep"
          >
            <ThumbsUp className="h-4 w-4" />
            {t(locale, 'drift.seeMore')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DriftCard({
  entry,
  level,
  locale,
  dictionaryCacheKey = 'default',
  dictionarySettings,
}: {
  entry: Entry;
  level: DriftLevel;
  locale: UiLocale;
  dictionaryCacheKey?: string;
  dictionarySettings?: AppSettings;
}) {
  return (
    <article className="rounded-2xl border border-border bg-card p-6 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full bg-chip px-3 py-1 text-[11px] tracking-[1px] text-muted">
          {t(locale, entry.kind === 'word' ? 'review.kindWord' : 'review.kindQuote')}
        </span>
        <WeightScale level={level} locale={locale} />
      </div>

      <p
        data-testid="drift-text"
        className="text-[28px] leading-relaxed text-ink"
        lang="zh-Hans"
      >
        {entry.text}
      </p>
      <p className="mt-1 text-sm text-muted">{entry.pinyin ?? toPinyin(entry.text)}</p>

      {entry.kind === 'word' ? (
        <div className="mt-4 flex flex-col gap-3">
          <SpeakButton text={entry.text} locale={locale} />
          {/* initiallyRevealed: Drift never hides anything. */}
          <ReviewInsightReveal
            word={entry}
            locale={locale}
            initiallyRevealed
            dictionaryCacheKey={dictionaryCacheKey}
            dictionarySettings={dictionarySettings}
          />
        </div>
      ) : (
        <QuoteBody quote={entry} />
      )}
    </article>
  );
}

function QuoteBody({ quote }: { quote: QuoteEntry }) {
  const translation = quote.translations?.ai?.text ?? quote.translations?.google?.text;
  return (
    <div className="mt-4 space-y-3">
      {translation && <p className="text-sm text-ink-secondary">{translation}</p>}
      {quote.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {quote.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-chip px-2.5 py-0.5 text-xs text-muted">
              {tag}
            </span>
          ))}
        </div>
      )}
      {quote.sourceUrl && (
        <a
          href={quote.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-muted underline decoration-dotted"
        >
          {quote.sourceTitle || quote.sourceDomain}
        </a>
      )}
    </div>
  );
}

const LEVELS: DriftLevel[] = [MIN_DRIFT_LEVEL, -1, 0, 1, MAX_DRIFT_LEVEL];

function WeightScale({ level, locale }: { level: DriftLevel; locale: UiLocale }) {
  return (
    <span
      className="inline-flex items-center gap-1"
      title={t(locale, 'drift.weightLabel')}
      aria-label={formatMessage(locale, 'drift.weightDot', {
        n: LEVELS.indexOf(level) + 1,
      })}
    >
      {LEVELS.map((step) => (
        <span
          key={step}
          data-testid="drift-dot"
          className={`h-1.5 w-1.5 rounded-full ${
            step === level ? 'bg-accent-deep' : 'bg-border'
          }`}
        />
      ))}
    </span>
  );
}
```

The reused components' signatures are verified against the current source: `SpeakButton({ text, locale })` at `SpeakButton.tsx:15`, and `ReviewInsightReveal({ word, locale, initiallyRevealed, dictionaryCacheKey, dictionarySettings })` at `ReviewInsightReveal.tsx:11-23`, matching the working call at `ReviewQueue.tsx:339-345`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/drift-view.test.tsx && npm run compile
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/dashboard/components/DriftView.tsx tests/drift-view.test.tsx && git commit -m "feat(drift): add DriftView with thumbs, skip, and exact-level undo"
```

---

### Task 9: Review-mode radio on the Settings page

**Files:**
- Modify: `entrypoints/settings/SettingsApp.tsx` (add a section above the existing SRS block near line 631)
- Test: `tests/settings-review-mode.test.tsx`

**Interfaces:**
- Consumes: `setReviewMode` from `lib/settings`; `useSettings().mutate`.

- [ ] **Step 1: Write the failing test**

Create `tests/settings-review-mode.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { fakeBrowser } from '@webext-core/fake-browser';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsApp } from '../entrypoints/settings/SettingsApp';
import { getSettings, replaceSettings } from '../lib/settings';
import { messages } from '../lib/i18n';

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fakeBrowser.reset();
  await replaceSettings({ ...(await getSettings()), uiLocale: 'en' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<SettingsApp />);
  });
}

describe('review mode setting', () => {
  it('shows both modes', async () => {
    await render();
    expect(container.textContent).toContain(messages.en['settings.modeSrs']);
    expect(container.textContent).toContain(messages.en['settings.modeDrift']);
  });

  it('starts on spaced repetition', async () => {
    await render();
    const srs = container.querySelector<HTMLInputElement>('[data-testid="review-mode-srs"]')!;
    expect(srs.checked).toBe(true);
  });

  it('persists a switch to drift', async () => {
    await render();
    await act(async () => {
      container
        .querySelector<HTMLInputElement>('[data-testid="review-mode-drift"]')!
        .click();
    });
    expect((await getSettings()).reviewMode).toBe('drift');
  });

  it('switches back without touching the SRS knobs', async () => {
    await render();
    await act(async () => {
      container.querySelector<HTMLInputElement>('[data-testid="review-mode-drift"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLInputElement>('[data-testid="review-mode-srs"]')!.click();
    });
    const settings = await getSettings();
    expect(settings.reviewMode).toBe('srs');
    expect(settings.srs.newCardsPerDay).toBe(20);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/settings-review-mode.test.tsx
```

Expected: FAIL — no element with `data-testid="review-mode-srs"`.

- [ ] **Step 3: Write the implementation**

In `entrypoints/settings/SettingsApp.tsx`, add `setReviewMode` to the import from `@/lib/settings` (join the existing list containing `setSrsSettings`), add `ReviewMode` to the type import from `@/lib/types`, then insert this section immediately **before** the block that renders `{t(locale, 'settings.srs')}` (around line 631):

```tsx
        <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
          <h2 className="text-sm font-medium tracking-[1px] text-ink-secondary">
            {t(locale, 'settings.reviewMode')}
          </h2>
          <p className="mt-1 text-xs text-muted">{t(locale, 'settings.reviewModeHint')}</p>

          <div className="mt-3 space-y-2">
            {(
              [
                { mode: 'srs' as const, testId: 'review-mode-srs', label: 'settings.modeSrs', hint: 'settings.modeSrsHint' },
                { mode: 'drift' as const, testId: 'review-mode-drift', label: 'settings.modeDrift', hint: 'settings.modeDriftHint' },
              ] satisfies Array<{
                mode: ReviewMode;
                testId: string;
                label: 'settings.modeSrs' | 'settings.modeDrift';
                hint: 'settings.modeSrsHint' | 'settings.modeDriftHint';
              }>
            ).map((option) => (
              <label
                key={option.mode}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                  settings.reviewMode === option.mode
                    ? 'border-accent bg-card-soft'
                    : 'border-border hover:border-accent-fade'
                }`}
              >
                <input
                  type="radio"
                  name="review-mode"
                  data-testid={option.testId}
                  checked={settings.reviewMode === option.mode}
                  onChange={() => {
                    void mutate((current) => setReviewMode(current, option.mode));
                  }}
                  className="mt-1 accent-[var(--color-accent)]"
                />
                <span>
                  <span className="block text-sm text-ink">{t(locale, option.label)}</span>
                  <span className="block text-xs text-muted">{t(locale, option.hint)}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
```

The SRS knobs stay visible in both modes — the SRS queue keeps accruing in the background while Drift is active, so they still govern something real.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/settings-review-mode.test.tsx && npm run compile
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/settings/SettingsApp.tsx tests/settings-review-mode.test.tsx && git commit -m "feat(drift): add review mode picker to the settings page"
```

---

### Task 10: Dashboard wiring

Renders Drift in the Review tab when selected, wires the thumb/skip/back handlers to the drift store, feeds drift days into the stats, and carries drift through backup and restore.

**Files:**
- Modify: `entrypoints/dashboard/App.tsx` (imports, `useDrift`, review-tab branch, stats call, `onRestore`, tab label). Anchors as of `f9375b1`: `getTabLabel` call at line 431, the review-chip condition at line 439, the `<ReviewQueue>` branch at lines 465-466, `onRestore` at lines 405-409.
- Modify: `entrypoints/dashboard/components/Toolbar.tsx` (backup serialization, restore type)
- Test: `tests/drift-dashboard.test.tsx`

**Interfaces:**
- Consumes: `useDrift`, `DriftView`, `nudgeLevel`, `setLevel`, `recordDriftDay`, `driftKey`, `buildDriftPool`, `computeReviewStats(..., driftStore.days)`, `replaceDriftStore`.

- [ ] **Step 1: Write the failing test**

Create `tests/drift-dashboard.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { fakeBrowser } from '@webext-core/fake-browser';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../entrypoints/dashboard/App';
import { getDriftStore } from '../lib/drift-storage';
import { messages } from '../lib/i18n';
import { setInbox } from '../lib/storage';
import { getSettings, replaceSettings } from '../lib/settings';
import type { WordEntry } from '../lib/types';

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

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fakeBrowser.reset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderApp() {
  await act(async () => {
    root.render(<App />);
  });
  // Let the storage-backed hooks settle.
  await act(async () => {});
}

describe('drift mode in the dashboard', () => {
  it('renders the SRS queue by default', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en' });
    await renderApp();
    expect(container.querySelector('[data-testid="drift-up"]')).toBeNull();
  });

  it('renders drift in the review tab when selected', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en', reviewMode: 'drift' });
    await renderApp();
    expect(container.querySelector('[data-testid="drift-up"]')).not.toBeNull();
  });

  it('persists a thumb-up to the drift store', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en', reviewMode: 'drift' });
    await renderApp();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="drift-up"]')!.click();
    });
    await act(async () => {});

    expect((await getDriftStore()).weights['你好']).toBe(1);
  });

  it('never writes FSRS state when drifting', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en', reviewMode: 'drift' });
    await renderApp();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="drift-up"]')!.click();
    });
    await act(async () => {});

    const { getInbox } = await import('../lib/storage');
    expect((await getInbox()).words[0].review).toBeUndefined();
  });

  it('counts a skip toward today without changing any weight', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en', reviewMode: 'drift' });
    await renderApp();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="drift-skip"]')!.click();
    });
    await act(async () => {});

    const store = await getDriftStore();
    expect(store.weights).toEqual({});
    expect(Object.values(store.days)).toEqual([1]);
  });

  it('shows the drift label on the review tab', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en', reviewMode: 'drift' });
    await renderApp();
    expect(container.textContent).toContain(messages.en['drift.title']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/drift-dashboard.test.tsx
```

Expected: FAIL — no `drift-up` control renders in the Review tab.

- [ ] **Step 3: Write the implementation**

In `entrypoints/dashboard/App.tsx`:

Add imports:

```ts
import { DriftView } from './components/DriftView';
import { useDrift } from './hooks/useDrift';
import { driftKey, nudgeLevel, recordDriftDay, setLevel, type DriftLevel } from '@/lib/drift';
import { replaceDriftStore } from '@/lib/drift-storage';
```

Add the hook next to the other hook calls near `const [tab, setTab] = useState<Tab>('review');`:

```ts
  const { driftStore, mutateDrift } = useDrift();
  const driftMode = settings.reviewMode === 'drift';
```

Add the three handlers alongside `answerEntry` / `postponeEntry`:

```ts
  async function driftThumb(
    entry: Entry,
    delta: 1 | -1,
    _previousLevel: DriftLevel,
    dayKey: string,
  ) {
    const key = driftKey(entry);
    await mutateDrift((store) => recordDriftDay(nudgeLevel(store, key, delta), dayKey, 1));
  }

  async function driftSkip(dayKey: string) {
    await mutateDrift((store) => recordDriftDay(store, dayKey, 1));
  }

  /** Restores the exact pre-tap level, so undoing a clamped tap is correct. */
  async function driftBack(entry: Entry, previousLevel: DriftLevel, dayKey: string) {
    const key = driftKey(entry);
    await mutateDrift((store) =>
      recordDriftDay(setLevel(store, key, previousLevel), dayKey, -1),
    );
  }
```

Pass drift days into the stats — find the `computeReviewStats(...)` call that produces `reviewStats` and add the third argument:

```ts
  const reviewStats = useMemo(
    () => computeReviewStats(inbox, reviewNow, driftStore.days),
    [inbox, reviewNow, driftStore.days],
  );
```

(Keep whatever memo shape the file already uses; only the third argument and the `driftStore.days` dependency are new.)

Replace the review branch of the tab render (line 465):

```tsx
          ) : tab === 'review' ? (
            driftMode ? (
              <DriftView
                inbox={inbox}
                store={driftStore}
                onThumb={driftThumb}
                onSkip={driftSkip}
                onBack={driftBack}
                locale={locale}
                dictionaryCacheKey={dictionaryCacheKey}
                dictionarySettings={settings}
              />
            ) : (
              <ReviewQueue
                items={reviewItems}
                onAnswer={answerEntry}
                onPostpone={postponeEntry}
                locale={locale}
                dictionaryCacheKey={dictionaryCacheKey}
                dictionarySettings={settings}
              />
            )
          ) : tab === 'words' ? (
```

(Keep the exact props the existing `ReviewQueue` call site passes — copy them rather than retyping.)

Update `getTabLabel` so the Review tab reads as Drift when Drift is active. Change its signature and the call site:

```ts
function getTabLabel(
  tab: Tab,
  counts: { review: number; words: number; quotes: number },
  locale: UiLocale,
  driftMode = false,
): string {
  if (tab === 'stats') return t(locale, 'tab.stats');
  if (tab === 'review') {
    return driftMode
      ? t(locale, 'drift.title')
      : `${t(locale, 'tab.review')} (${counts.review})`;
  }
  if (tab === 'words') return `${t(locale, 'tab.words')} (${counts.words})`;
  return `${t(locale, 'tab.quotes')} (${counts.quotes})`;
}
```

and at the call site (line 431):

```tsx
                  {getTabLabel(nextTab, {
                    review: reviewDueCount,
                    words: inbox.words.length,
                    quotes: inbox.quotes.length,
                  }, locale, driftMode)}
```

Also hide the "Review today" chip in Drift mode — change the condition at line 439 from `tab === 'stats' ? null : tab === 'review' ? (` to:

```tsx
            {tab === 'stats' || (tab === 'review' && driftMode) ? null : tab === 'review' ? (
```

Extend `onRestore` to restore drift state too:

```tsx
          onRestore={async (restored) => {
            await replace(restored.inbox);
            if (restored.settings) await requestSyncMutation('settings', restored.settings);
            if (restored.aiSettings) await requestSyncMutation('ai', restored.aiSettings);
            // Drift lives outside the sync domain — write it directly.
            await replaceDriftStore(restored.drift);
          }}
```

In `entrypoints/dashboard/components/Toolbar.tsx`:

Add the import and hook so the backup carries drift:

```ts
import { getDriftStore } from '@/lib/drift-storage';
```

and change `downloadBackup` (line 78-85) to read the store at export time:

```ts
  async function downloadBackup() {
    const confirmed = window.confirm(t(locale, 'sync.warn.backupUnencrypted'));
    if (!confirmed) return;
    const json = serializeFullBackup(inbox, settings, aiSettings, await getDriftStore());
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    await downloadBlob(blob, `shiyu-hanzi-box-backup-${todayStamp()}.json`);
    setMessage({ tone: 'success', text: t(locale, 'toolbar.backupReady') });
  }
```

The `onRestore` prop type in `Toolbar.tsx` is derived from `restoreFullBackup`'s return type, so it picks up `drift` automatically. If it is written out by hand, add `drift: DriftStore` and import the type from `@/lib/drift`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run && npm run compile
```

Expected: full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/dashboard/App.tsx entrypoints/dashboard/components/Toolbar.tsx tests/drift-dashboard.test.tsx && git commit -m "feat(drift): render drift in the review tab and carry it through backup"
```

---

### Task 11: Drift in the Stats tab

**Files:**
- Modify: `entrypoints/dashboard/components/ReviewStatsTab.tsx`
- Test: `tests/review-stats-tab.test.tsx` (append)

**Interfaces:**
- Consumes: `ReviewStats.driftedToday`, `ReviewStats.totalDrifted`, `DayCount.driftCount`.

- [ ] **Step 1: Write the failing test**

Append to `tests/review-stats-tab.test.tsx`. The file already defines `makeStats`, `makeSrs`, and an async `render(node: ReactNode)` helper — reuse them. First add `driftedToday: 0` and `totalDrifted: 0` to `makeStats`'s defaults (the typecheck requires it), then add `import { messages } from '../lib/i18n';` at the top.

```tsx
describe('drift in the stats tab', () => {
  it('outlines a drift-only day in the heatmap', async () => {
    await render(
      <ReviewStatsTab
        stats={makeStats({ heatmap: [{ date: '2026-08-11', count: 0, driftCount: 4 }] })}
        srsStats={makeSrs()}
        locale="en"
      />,
    );
    expect(container.querySelector('[data-testid="heat-cell"]')!.className).toContain('border');
  });

  it('titles a drift day with both figures', async () => {
    await render(
      <ReviewStatsTab
        stats={makeStats({ heatmap: [{ date: '2026-08-11', count: 2, driftCount: 4 }] })}
        srsStats={makeSrs()}
        locale="en"
      />,
    );
    const title = container.querySelector('[data-testid="heat-cell"]')!.getAttribute('title');
    expect(title).toContain('4');
    expect(title).toContain('2');
  });

  it('leaves a review-only day on the plain tooltip', async () => {
    await render(
      <ReviewStatsTab
        stats={makeStats({ heatmap: [{ date: '2026-08-11', count: 2, driftCount: 0 }] })}
        srsStats={makeSrs()}
        locale="en"
      />,
    );
    expect(container.querySelector('[data-testid="heat-cell"]')!.getAttribute('title'))
      .toBe('2026-08-11: 2 reviews');
  });

  it('shows the lifetime drift figure', async () => {
    await render(
      <ReviewStatsTab stats={makeStats({ totalDrifted: 42 })} srsStats={makeSrs()} locale="en" />,
    );
    expect(container.textContent).toContain('42');
  });

  it('hides the drift legend when nothing has been drifted', async () => {
    await render(
      <ReviewStatsTab stats={makeStats({ totalDrifted: 0 })} srsStats={makeSrs()} locale="en" />,
    );
    expect(container.textContent).not.toContain(messages.en['stats.legendDrift']);
  });

  it('treats a drift-only day as keeping the streak safe', async () => {
    await render(
      <ReviewStatsTab
        stats={makeStats({ streakState: 'safe', currentStreak: 3, reviewedToday: 0, driftedToday: 5 })}
        srsStats={makeSrs({ reviewedToday: 0 })}
        locale="en"
      />,
    );
    expect(container.textContent).toContain(messages.en['stats.safeReviewed']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/review-stats-tab.test.tsx
```

Expected: FAIL — the drift figure and the distinct cell styling do not render.

- [ ] **Step 3: Write the implementation**

In `entrypoints/dashboard/components/ReviewStatsTab.tsx`:

Update `streakLine` (line 25) so a drift-only day counts as showing up:

```ts
  if (stats.reviewedToday > 0 || stats.driftedToday > 0) return t(locale, 'stats.safeReviewed');
```

Replace the heatmap cell render (lines 83-90) with:

```tsx
          {stats.heatmap.map((cell: DayCount) => {
            const drifted = cell.driftCount ?? 0;
            const label = drifted > 0
              ? formatMessage(locale, 'stats.heatmapCellDrift', {
                  date: cell.date,
                  n: cell.count,
                  d: drifted,
                })
              : formatMessage(locale, 'stats.heatmapCell', { date: cell.date, n: cell.count });
            return (
              <div
                key={cell.date}
                data-testid="heat-cell"
                title={label}
                aria-label={label}
                // A drift-only day is outlined rather than filled: it kept the
                // streak alive, but it was not retrieval practice.
                className={`h-3 w-3 rounded-[3px] ${heatClass(cell.count)} ${
                  drifted > 0 && cell.count === 0 ? 'border border-accent-fade' : ''
                }`}
              />
            );
          })}
```

Add the legend line directly under the heatmap grid, inside the same `<section>`:

```tsx
        {stats.totalDrifted > 0 && (
          <p className="mt-2 text-[11px] text-muted">{t(locale, 'stats.legendDrift')}</p>
        )}
```

Replace the total-reviews line (lines 118-120) with both figures:

```tsx
      {/* Lifetime totals — reviews and drift stay separate on purpose. */}
      <p className="text-center text-xs text-muted">
        {formatMessage(locale, 'stats.totalReviews', { n: stats.totalReviews.toLocaleString(locale) })}
        {stats.totalDrifted > 0 && (
          <>
            {' · '}
            {formatMessage(locale, 'stats.totalDrifted', {
              n: stats.totalDrifted.toLocaleString(locale),
            })}
          </>
        )}
      </p>
```

- [ ] **Step 4: Run the full suite and typecheck**

```bash
npx vitest run && npm run compile
```

Expected: full suite PASS, typecheck clean.

- [ ] **Step 5: Build the extension to confirm it packages**

```bash
npm run build
```

Expected: WXT build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/dashboard/components/ReviewStatsTab.tsx tests/review-stats-tab.test.tsx && git commit -m "feat(drift): surface drift days in the stats tab"
```

---

## Manual verification

After Task 11, load the unpacked extension from `.output/chrome-mv3` and check:

1. Settings shows "Review mode" with Spaced repetition selected. The dashboard Review tab is unchanged.
2. Select Drift. The Review tab now reads "Drift" and shows one card with everything visible — a word card with definitions expanded, a quote card with no blanks.
3. Thumb-down several times on one entry; the dot scale moves left and stops at the leftmost dot. Thumb-up walks it back.
4. Back returns to the previous card and the dot scale returns to where it was — including for a card you thumbed at a bound.
5. Stats shows today as an active day and the "cards drifted all-time" figure. The streak survives a day with drift but no reviews.
6. Switch back to Spaced repetition. The SRS queue is intact and shows the backlog that accrued.
7. Export a backup; the JSON has `"formatVersion": 4` and a `drift` key. Restore an older v3 backup and confirm settings and the AI key survive.

## README

The README's "Current Status" list is the project's feature ledger. After Task 11, add a bullet under the spaced-repetition entry:

> - A second **Drift (漫读)** review mode, selectable in Settings: words and
>   quotes surface one at a time in weighted random order with nothing hidden,
>   and thumbs up / down shape how often each one comes back. Drift never writes
>   FSRS state; drift days keep the review streak alive without counting as
>   reviews.

Commit with the Task 11 changes or as a follow-up `docs:` commit.
