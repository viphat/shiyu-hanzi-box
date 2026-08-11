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
 * Weights key on the sync key space, not on `entry.id`. `pickWordId` in
 * lib/sync/project.ts chooses a canonical id when two replicas merge the same
 * word, so a word's id can change under the user; `normalized` cannot.
 *
 * Both kinds carry a prefix (`word:` / `quote:`), not just words, so the two
 * key spaces can never collide: without it, a word whose `normalized` text
 * happened to be the literal string `quote:q1` would produce the same key as
 * the quote with id `q1`. Vanishingly unlikely, but free to rule out.
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

  const windowSize = recentWindowSize(pool.length);
  // `recent.slice(-windowSize)` would be wrong for windowSize === 0: slice's
  // start index is only treated as "from the end" when strictly negative, and
  // -0 < 0 is false, so slice(-0) returns the *whole* array instead of none.
  const blocked = new Set(windowSize > 0 ? recent.slice(-windowSize) : []);
  const candidates = pool.filter((entry) => !blocked.has(driftKey(entry)));
  // For a singleton pool, windowSize is 0, so blocked is empty and the sole
  // entry is always a genuine candidate — no fallback needed there. More
  // generally, windowSize < pool.length by construction (recentWindowSize
  // halves and caps), so blocked can never cover every *distinct* candidate.
  // The fallback below is load-bearing, not dead code, but not for the reason
  // it might look like: `recent.slice(-windowSize)` above already caps
  // `blocked` regardless of how long a caller-supplied `recent` is, so an
  // over-long or out-of-pool `recent` isn't the risk. What it actually
  // defends against is the windowSize < pool.length invariant being violated
  // — e.g. duplicate driftKeys within `pool` (which shrinks the number of
  // distinct candidates below windowSize while pool.length stays the same),
  // or a future regression in recentWindowSize that drops the guarantee.
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
