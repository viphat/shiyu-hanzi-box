import type { Inbox, ReviewState } from './types';
import { localDayKey, startOfDay } from './srs';

/**
 * Pure, deterministic habit metrics derived on-read from the loaded Inbox.
 * No I/O, no React, no storage, no sync.
 *
 * Cross-device note: word review history is synced (see lib/sync/project.ts
 * reviewEvents/rebuildReview), but clozes are NOT projected into sync state, so
 * cloze review history is this-device-only. The streak/heatmap therefore reflect
 * all synced word reviews plus this device's cloze reviews. This is intentional
 * for this release; the sync layer is unchanged.
 */

export interface DayCount {
  /** Local calendar day, 'YYYY-MM-DD'. */
  date: string;
  count: number;
}

export type StreakState = 'safe' | 'at-risk' | 'broken';

export interface ReviewStats {
  /** Lifetime count of reviewLog entries across all words + clozes. */
  totalReviews: number;
  /** Active days in the current run (freeze rule applied). 0 when none/broken. */
  currentStreak: number;
  /** Longest historical run (freeze rule applied). */
  longestStreak: number;
  streakState: StreakState;
  /** Reviews logged today (local). Equals heatmap's final cell by construction. */
  reviewedToday: number;
  /** Last 84 days (12 weeks), oldest->newest, zero-filled, ending today. */
  heatmap: DayCount[];
  /** Next 7 days incl. today, due-card counts; overdue folds into today. */
  forecast: DayCount[];
}

export const HEATMAP_DAYS = 84;
export const FORECAST_DAYS = 7;

/**
 * Flattens word.review (when present) and every quote cloze's review.
 * Archived entries are included on purpose. Cards with no ReviewState are
 * omitted (they are "new / unscheduled").
 */
export function collectReviewStates(inbox: Inbox): ReviewState[] {
  const states: ReviewState[] = [];
  for (const word of inbox.words) {
    if (word.review) states.push(word.review);
  }
  for (const quote of inbox.quotes) {
    for (const cloze of quote.clozes ?? []) {
      if (cloze.review) states.push(cloze.review);
    }
  }
  return states;
}

/** Buckets every reviewLog[].reviewedAt by local day. The single place the
 * local-midnight rule is applied to history. */
export function reviewDayCounts(states: ReviewState[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const state of states) {
    for (const entry of state.reviewLog ?? []) {
      const key = localDayKey(entry.reviewedAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Convert a 'YYYY-MM-DD' key to a monotonic integer day ordinal.
 * Uses Date.UTC so ordinal differences are exact whole days (DST-proof). */
function dayKeyToOrdinal(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** True when two active ordinals belong to the same tolerant run:
 * gap 1 = consecutive, gap 2 = one missed day forgiven. gap >= 3 breaks. */
function continuesRun(newer: number, older: number): boolean {
  const gap = newer - older;
  return gap === 1 || gap === 2;
}

export function computeStreak(
  dayCounts: Map<string, number>,
  today: string,
): { current: number; longest: number; state: StreakState } {
  const ordinals = [...dayCounts.keys()]
    .map(dayKeyToOrdinal)
    .sort((a, b) => a - b);

  // Longest tolerant run across all history.
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const ord of ordinals) {
    run = prev !== null && continuesRun(ord, prev) ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = ord;
  }

  const todayOrd = dayKeyToOrdinal(today);

  // Most recent active day at or before today.
  let lastActive: number | null = null;
  for (const ord of ordinals) {
    if (ord <= todayOrd) lastActive = ord; // sorted asc => last write wins
  }
  if (lastActive === null) {
    return { current: 0, longest, state: 'broken' };
  }

  const gap = todayOrd - lastActive;
  let state: StreakState;
  if (gap <= 1) state = 'safe';
  else if (gap === 2) state = 'at-risk';
  else return { current: 0, longest, state: 'broken' };

  // Count the current run: walk active ordinals backward from lastActive.
  let current = 0;
  let cursor: number | null = null;
  for (let i = ordinals.length - 1; i >= 0; i -= 1) {
    const ord = ordinals[i];
    if (ord > lastActive) continue;
    if (cursor === null) {
      current = 1;
    } else if (continuesRun(cursor, ord)) {
      current += 1;
    } else {
      break;
    }
    cursor = ord;
  }

  return { current, longest, state };
}

export function buildHeatmap(
  dayCounts: Map<string, number>,
  now: number,
  days = HEATMAP_DAYS,
): DayCount[] {
  const base = new Date(startOfDay(now));
  const year = base.getFullYear();
  const month = base.getMonth();
  const date = base.getDate();
  const cells: DayCount[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    // new Date(y, m, d - i) normalizes across month/DST boundaries.
    const key = localDayKey(new Date(year, month, date - i).getTime());
    cells.push({ date: key, count: dayCounts.get(key) ?? 0 });
  }
  return cells;
}
