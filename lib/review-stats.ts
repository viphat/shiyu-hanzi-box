import type { Inbox, ReviewState } from './types';
import { localDayKey } from './srs';

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
