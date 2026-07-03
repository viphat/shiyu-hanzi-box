# Review Stats & Streak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a motivation-focused **Stats** tab to the dashboard whose hero is a review **streak** (one-grace-day freeze), backed by a 12-week activity heatmap, a 7-day due forecast, and a lifetime total — all derived on-read from data already loaded.

**Architecture:** One new pure module (`lib/review-stats.ts`) turns the in-memory `Inbox` + a clock into a `ReviewStats` object; one new presentational component (`ReviewStatsTab.tsx`) renders it. The dashboard composes the existing `getSrsStats` (today's due/reviewed) with the new historical metrics. No storage, sync, or permission changes. The single change to existing code is exporting a shared local-day helper from `lib/srs.ts`.

**Tech Stack:** TypeScript, React 19, WXT (browser extension), Tailwind v4 (CSS-variable theme in `styles.css`), Vitest + happy-dom, ts-fsrs (already wired). No new dependencies, no charting library.

## Global Constraints

- **No new storage key, no precompute/cache, no sync changes, no migration, no new permissions.** The tab is read-only.
- **No charting library.** Heatmap and forecast are hand-rolled with divs + Tailwind theme tokens.
- **i18n parity is enforced.** Every new string exists in **both** `messages.en` and `messages['zh-CN']` in [lib/i18n.ts](../../../lib/i18n.ts). `tests/i18n-source.test.ts` fails the build otherwise.
- **No inline `locale === 'en' ? …` in `entrypoints/`.** All UI strings go through `t(locale, key)` (static) or `formatMessage(locale, key, values)` (interpolated). `tests/i18n-source.test.ts` greps for and forbids the ternary form.
- **Theme tokens only** (from `styles.css`): `paper-light`, `paper-input`, `card`, `card-soft`, `chip`, `border`, `border-soft`, `ink`, `ink-secondary`, `muted`, `accent`, `accent-deep`, `accent-strong`, `accent-tint`, `accent-wash`. **`cinnabar` does not exist** — the accent family is sage-green.
- **Local-day boundary is defined once.** Bucketing and streak math reuse `startOfDay` / `startOfNextDay` / `localDayKey` from `lib/srs.ts`. Never re-derive midnight.
- **Verification:** `npm run compile` (`tsc --noEmit`) and `npm test` (`vitest run`) must both be green before completion.

---

## Findings addressed before planning (spec review)

These were verified against the codebase and are baked into the tasks below:

1. **Cross-device history (spec's open "verify during planning" item) — RESOLVED.** In [lib/sync/project.ts](../../../lib/sync/project.ts), `projectScheduler` emits one `reviewEvent` per `reviewLog` entry (full payload) and `rebuildReview` reconstructs the complete `reviewLog` on `materialize`, so **word** review history survives sync and is cross-device. However, `projectQuote` projects only the legacy top-level `quote.review`, and `QuoteNode` ([lib/sync/types.ts](../../../lib/sync/types.ts)) has **no `clozes` field** — **cloze review history is local-only.** Net behavior: streak/heatmap/total reflect *all synced word reviews + this device's cloze reviews*. This matches the spec's anticipated "local-only → document, don't change sync" branch. **No sync change in this feature.** Documented in the module header (Task 2, Step 3).
2. **`localDayKey` does not exist yet.** Only a private `startOfDay` exists in `lib/srs.ts`. Task 1 exports `startOfDay` and adds a new `localDayKey` that formats from **local** date parts (never `toISOString`, which is UTC and shifts the day).
3. **`cinnabar` token was removed** (styles.css comment: "Sage-green accent (replaces cinnabar)"). The heatmap ramps through `accent-tint → accent-wash → accent → accent-deep`.
4. **Interpolated keys require `formatMessage`**, not `t`. Applied in `ReviewStatsTab`.
5. **Version drift:** repo is at `0.3.0`; the spec title says v0.2.2. Task 9 bumps `package.json` to `0.4.0` (recommended; confirm with maintainer if a different number is preferred).
6. **`reviewedToday` semantics:** `computeReviewStats` includes archived cards (a review you did still happened); `getSrsStats.reviewedToday` excludes archived. `ReviewStats.reviewedToday` equals the heatmap's final cell by construction; the "Today" tile uses `srsStats` (active-only), so the two can differ only if you archived a card you reviewed today. Accepted and noted.

---

## File Structure

- **`lib/srs.ts`** (modify) — export `startOfDay`; add and export `localDayKey`. Nothing else changes.
- **`lib/review-stats.ts`** (new, pure) — types (`DayCount`, `StreakState`, `ReviewStats`) + helpers (`collectReviewStates`, `reviewDayCounts`, `computeStreak`, `buildHeatmap`, `buildForecast`) + public `computeReviewStats`. No React, no I/O.
- **`lib/i18n.ts`** (modify) — `tab.stats` + `stats.*` keys in both locales.
- **`entrypoints/dashboard/components/ReviewStatsTab.tsx`** (new) — presentational; renders hero / today / heatmap / forecast / total from `ReviewStats` + `SrsStats`.
- **`entrypoints/dashboard/App.tsx`** (modify) — add `'stats'` to `Tab`, the tab button (no count), the `computeReviewStats` memo, and the `tab === 'stats'` render branch.
- **`package.json`** (modify) — version bump.
- **Tests:** `tests/local-day.test.ts` (new), `tests/review-stats.test.ts` (new), `tests/review-stats-tab.test.tsx` (new). `tests/i18n-source.test.ts` (existing) must stay green.

---

## Task 1: Shared local-day helpers in `lib/srs.ts`

**Files:**
- Modify: `lib/srs.ts` (line 397 `function startOfDay` → export; add `localDayKey` immediately after `endOfDay`)
- Test: `tests/local-day.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export function startOfDay(time: number): number` — local-midnight epoch ms for `time`.
  - `export function localDayKey(time: number): string` — local calendar day as `'YYYY-MM-DD'`.

- [ ] **Step 1: Write the failing test**

Create `tests/local-day.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { localDayKey, startOfDay } from '../lib/srs';

describe('startOfDay', () => {
  it('returns local midnight for a mid-day timestamp', () => {
    const t = new Date('2026-07-03T14:22:33').getTime();
    expect(startOfDay(t)).toBe(new Date('2026-07-03T00:00:00').getTime());
  });
});

describe('localDayKey', () => {
  it('formats the local calendar day as YYYY-MM-DD', () => {
    const t = new Date('2026-07-03T14:22:33').getTime();
    expect(localDayKey(t)).toBe('2026-07-03');
  });

  it('zero-pads month and day', () => {
    const t = new Date('2026-01-05T09:00:00').getTime();
    expect(localDayKey(t)).toBe('2026-01-05');
  });

  it('uses the local day, matching startOfDay', () => {
    const t = new Date('2026-07-03T23:59:59').getTime();
    expect(localDayKey(t)).toBe(localDayKey(startOfDay(t)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/local-day.test.ts`
Expected: FAIL — `localDayKey` is not exported (`startOfDay` is currently a private function, so its import also fails).

- [ ] **Step 3: Make `startOfDay` exported and add `localDayKey`**

In `lib/srs.ts`, change the existing declaration (around line 397) from:

```ts
function startOfDay(time: number): number {
```

to:

```ts
export function startOfDay(time: number): number {
```

Then, immediately after the `endOfDay` function (around line 417), add:

```ts
/**
 * Local calendar day as 'YYYY-MM-DD'. Uses local date parts (NOT toISOString,
 * which is UTC and would shift the day across the local-midnight boundary).
 * This is the single definition of the day key shared with lib/review-stats.ts.
 */
export function localDayKey(time: number): string {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/local-day.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/srs.ts tests/local-day.test.ts
git commit -m "feat(srs): export startOfDay and add localDayKey helper"
```

---

## Task 2: `review-stats` module scaffold — types, `collectReviewStates`, `reviewDayCounts`

**Files:**
- Create: `lib/review-stats.ts`
- Test: `tests/review-stats.test.ts` (new)

**Interfaces:**
- Consumes: `localDayKey` from `lib/srs.ts`; `Inbox`, `ReviewState` from `lib/types.ts`.
- Produces:
  - `interface DayCount { date: string; count: number }`
  - `type StreakState = 'safe' | 'at-risk' | 'broken'`
  - `interface ReviewStats { totalReviews: number; currentStreak: number; longestStreak: number; streakState: StreakState; reviewedToday: number; heatmap: DayCount[]; forecast: DayCount[] }`
  - `function collectReviewStates(inbox: Inbox): ReviewState[]`
  - `function reviewDayCounts(states: ReviewState[]): Map<string, number>`

- [ ] **Step 1: Write the failing test**

Create `tests/review-stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { collectReviewStates, reviewDayCounts } from '../lib/review-stats';
import type { Cloze, Inbox, QuoteEntry, ReviewLogEntry, ReviewState, WordEntry } from '../lib/types';

const DAY = 24 * 60 * 60 * 1000;

function log(reviewedAt: number): ReviewLogEntry {
  return {
    reviewedAt,
    rating: 'good',
    elapsedDays: 0,
    scheduledDays: 1,
    stateBefore: 'review',
    stateAfter: 'review',
  };
}

function review(overrides: Partial<ReviewState> = {}): ReviewState {
  return { dueAt: 0, intervalDays: 0, repetitions: 0, lapses: 0, ...overrides };
}

function word(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'w1', kind: 'word', text: '山', normalized: '山', note: '',
    status: 'inbox', createdAt: 0, updatedAt: 0, occurrences: [], ...overrides,
  };
}

function quote(clozes: Cloze[], overrides: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1', kind: 'quote', text: '学而时习之', tags: [], note: '',
    status: 'inbox', createdAt: 0, updatedAt: 0, sourceTitle: '', sourceUrl: '',
    sourceDomain: '', surrounding: '', clozes, ...overrides,
  };
}

function inbox(words: WordEntry[], quotes: QuoteEntry[]): Inbox {
  return { words, quotes };
}

describe('collectReviewStates', () => {
  it('flattens word.review and each cloze.review, skipping absent reviews', () => {
    const w = word({ review: review() });
    const wNoReview = word({ id: 'w2' });
    const q = quote([
      { id: 'c1', start: 0, end: 1, review: review() },
      { id: 'c2', start: 1, end: 2 }, // no review => skipped
    ]);
    const states = collectReviewStates(inbox([w, wNoReview], [q]));
    expect(states).toHaveLength(2); // w.review + c1.review
  });

  it('includes archived entries (a review you did still happened)', () => {
    const w = word({ status: 'archived', review: review() });
    expect(collectReviewStates(inbox([w], []))).toHaveLength(1);
  });
});

describe('reviewDayCounts', () => {
  it('buckets reviewLog entries by local day', () => {
    const base = new Date('2026-07-03T09:00:00').getTime();
    const states: ReviewState[] = [
      review({ reviewLog: [log(base), log(base + 60_000)] }), // both same day
      review({ reviewLog: [log(base - DAY)] }),               // previous day
    ];
    const counts = reviewDayCounts(states);
    expect(counts.get('2026-07-03')).toBe(2);
    expect(counts.get('2026-07-02')).toBe(1);
  });

  it('returns an empty map when there are no logs', () => {
    expect(reviewDayCounts([review()]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/review-stats.test.ts`
Expected: FAIL — cannot find module `../lib/review-stats`.

- [ ] **Step 3: Create the module with types and both helpers**

Create `lib/review-stats.ts`:

```ts
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
```

> Note: import only `localDayKey` here — it is the only `srs` helper this task uses. Task 4 adds `startOfDay` to the import when `buildHeatmap`/`buildForecast` need it. `startOfNextDay` is not used by this module.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/review-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/review-stats.ts tests/review-stats.test.ts
git commit -m "feat(review-stats): module scaffold — types, collectReviewStates, reviewDayCounts"
```

---

## Task 3: `computeStreak` — the freeze rule

**Files:**
- Modify: `lib/review-stats.ts`
- Modify: `tests/review-stats.test.ts`

**Interfaces:**
- Consumes: `reviewDayCounts` output (`Map<string, number>`), a `today` key (`'YYYY-MM-DD'`).
- Produces: `function computeStreak(dayCounts: Map<string, number>, today: string): { current: number; longest: number; state: StreakState }`

Rule (local calendar days): a day is **active** if its count > 0. `gap = today - lastActive` in whole days. `gap 0|1 → safe`, `gap 2 → at-risk`, `gap >= 3` or no reviews → `broken` (`current = 0`). Counting walks backward from `lastActive` over active days, tolerating a **single** missed day (gap of 2), stopping at the first **two consecutive** misses (gap >= 3). Longest applies the same tolerant-run logic across all history.

- [ ] **Step 1: Write the failing test**

Append to `tests/review-stats.test.ts`:

```ts
import { computeStreak } from '../lib/review-stats';

// Build an active-day map from 'YYYY-MM-DD' keys.
function active(...days: string[]): Map<string, number> {
  return new Map(days.map((d) => [d, 1]));
}

describe('computeStreak (freeze rule)', () => {
  const today = '2026-07-03';

  it('reviewed today: safe, counts today', () => {
    const r = computeStreak(active('2026-07-01', '2026-07-02', '2026-07-03'), today);
    expect(r).toEqual({ current: 3, longest: 3, state: 'safe' });
  });

  it('active yesterday only: safe, no +1 for today', () => {
    const r = computeStreak(active('2026-07-01', '2026-07-02'), today);
    expect(r.state).toBe('safe');
    expect(r.current).toBe(2); // ends yesterday; today not counted
  });

  it('one missed day is forgiven (freeze): run continues', () => {
    // active today, missed yesterday (07-02), active 07-01
    const r = computeStreak(active('2026-06-30', '2026-07-01', '2026-07-03'), today);
    expect(r.state).toBe('safe');
    expect(r.current).toBe(3);
  });

  it('two consecutive misses: broken, resets to 0', () => {
    // last active 06-30 => gap of 3 to today
    const r = computeStreak(active('2026-06-29', '2026-06-30'), today);
    expect(r.state).toBe('broken');
    expect(r.current).toBe(0);
  });

  it('at-risk: gap == 2 (yesterday missed, today pending)', () => {
    // last active 07-01 => gap 2
    const r = computeStreak(active('2026-06-30', '2026-07-01'), today);
    expect(r.state).toBe('at-risk');
    expect(r.current).toBe(2); // run ending 07-01
  });

  it('never reviewed: 0, broken', () => {
    expect(computeStreak(new Map(), today)).toEqual({ current: 0, longest: 0, state: 'broken' });
  });

  it('every-other-day pattern stays alive (accepted caveat)', () => {
    const r = computeStreak(active('2026-06-29', '2026-07-01', '2026-07-03'), today);
    expect(r.state).toBe('safe');
    expect(r.current).toBe(3);
  });

  it('longest can exceed current', () => {
    // long past run (5 consecutive) then broken, then a fresh 1-day current
    const r = computeStreak(
      active('2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-07-03'),
      today,
    );
    expect(r.current).toBe(1);
    expect(r.longest).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/review-stats.test.ts`
Expected: FAIL — `computeStreak` is not exported.

- [ ] **Step 3: Implement `computeStreak`**

Add to `lib/review-stats.ts` (after `reviewDayCounts`):

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/review-stats.test.ts`
Expected: PASS (all streak cases green).

- [ ] **Step 5: Commit**

```bash
git add lib/review-stats.ts tests/review-stats.test.ts
git commit -m "feat(review-stats): computeStreak with one-grace-day freeze rule"
```

---

## Task 4: `buildHeatmap`

**Files:**
- Modify: `lib/review-stats.ts`
- Modify: `tests/review-stats.test.ts`

**Interfaces:**
- Consumes: `reviewDayCounts` output, `now` (epoch ms), `days` (default `HEATMAP_DAYS`).
- Produces: `function buildHeatmap(dayCounts: Map<string, number>, now: number, days?: number): DayCount[]` — length `days`, oldest→newest, zero-filled, ending today.

- [ ] **Step 1: Write the failing test**

Append to `tests/review-stats.test.ts`:

```ts
import { buildHeatmap, HEATMAP_DAYS } from '../lib/review-stats';

describe('buildHeatmap', () => {
  const now = new Date('2026-07-03T09:00:00').getTime();

  it('has length 84 by default, oldest first, ending today', () => {
    const h = buildHeatmap(new Map(), now);
    expect(h).toHaveLength(HEATMAP_DAYS);
    expect(h[h.length - 1].date).toBe('2026-07-03');
    // 83 days before 2026-07-03 is 2026-04-11
    expect(h[0].date).toBe('2026-04-11');
  });

  it('zero-fills days with no reviews', () => {
    const h = buildHeatmap(new Map([['2026-07-02', 4]]), now, 3);
    expect(h.map((c) => [c.date, c.count])).toEqual([
      ['2026-07-01', 0],
      ['2026-07-02', 4],
      ['2026-07-03', 0],
    ]);
  });

  it('final cell equals today\'s review count', () => {
    const h = buildHeatmap(new Map([['2026-07-03', 7]]), now);
    expect(h[h.length - 1]).toEqual({ date: '2026-07-03', count: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/review-stats.test.ts`
Expected: FAIL — `buildHeatmap` is not exported.

- [ ] **Step 3: Implement `buildHeatmap`**

First, update the `srs` import at the top of `lib/review-stats.ts` to add `startOfDay` (used by `buildHeatmap` and, in Task 5, `buildForecast`):

```ts
import { localDayKey, startOfDay } from './srs';
```

Then add to `lib/review-stats.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/review-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/review-stats.ts tests/review-stats.test.ts
git commit -m "feat(review-stats): buildHeatmap (84 days, zero-filled, ends today)"
```

---

## Task 5: `buildForecast`

**Files:**
- Modify: `lib/review-stats.ts`
- Modify: `tests/review-stats.test.ts`

**Interfaces:**
- Consumes: `collectReviewStates` output (`ReviewState[]`), `now` (epoch ms), `days` (default `FORECAST_DAYS`).
- Produces: `function buildForecast(states: ReviewState[], now: number, days?: number): DayCount[]` — length `days`, today→+6, bucketed by `review.dueAt`; overdue (before today) folds into today; anything beyond the window is dropped. Cards with no ReviewState never reach here.

- [ ] **Step 1: Write the failing test**

Append to `tests/review-stats.test.ts`:

```ts
import { buildForecast, FORECAST_DAYS } from '../lib/review-stats';

describe('buildForecast', () => {
  const now = new Date('2026-07-03T09:00:00').getTime();
  const at = (iso: string) => new Date(iso).getTime();

  it('has length 7, today first', () => {
    const f = buildForecast([], now);
    expect(f).toHaveLength(FORECAST_DAYS);
    expect(f[0].date).toBe('2026-07-03');
    expect(f[6].date).toBe('2026-07-09');
  });

  it('buckets each due date into its local day', () => {
    const states = [
      review({ dueAt: at('2026-07-03T20:00:00') }), // today (later)
      review({ dueAt: at('2026-07-05T08:00:00') }), // +2
      review({ dueAt: at('2026-07-05T22:00:00') }), // +2
    ];
    const f = buildForecast(states, now);
    expect(f[0].count).toBe(1);
    expect(f[2].count).toBe(2);
  });

  it('folds overdue cards into today', () => {
    const f = buildForecast([review({ dueAt: at('2026-06-20T00:00:00') })], now);
    expect(f[0].count).toBe(1);
  });

  it('drops due dates beyond the 7-day window', () => {
    const f = buildForecast([review({ dueAt: at('2026-07-30T00:00:00') })], now);
    expect(f.reduce((sum, c) => sum + c.count, 0)).toBe(0);
  });

  it('excludes cards with no ReviewState (via collectReviewStates upstream)', () => {
    // collectReviewStates omits reviewless cards, so forecast never sees them.
    const states = collectReviewStates(inbox([word({ id: 'nw' })], []));
    expect(buildForecast(states, now).reduce((s, c) => s + c.count, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/review-stats.test.ts`
Expected: FAIL — `buildForecast` is not exported.

- [ ] **Step 3: Implement `buildForecast`**

Add to `lib/review-stats.ts`:

```ts
export function buildForecast(
  states: ReviewState[],
  now: number,
  days = FORECAST_DAYS,
): DayCount[] {
  const base = new Date(startOfDay(now));
  const year = base.getFullYear();
  const month = base.getMonth();
  const date = base.getDate();

  const buckets: DayCount[] = [];
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < days; i += 1) {
    const key = localDayKey(new Date(year, month, date + i).getTime());
    indexByKey.set(key, i);
    buckets.push({ date: key, count: 0 });
  }

  const todayStart = startOfDay(now);
  const horizonEnd = new Date(year, month, date + days).getTime(); // start of day after window

  for (const state of states) {
    const due = state.dueAt;
    if (due < todayStart) {
      buckets[0].count += 1; // overdue -> today
      continue;
    }
    if (due >= horizonEnd) continue; // beyond window
    const idx = indexByKey.get(localDayKey(due));
    if (idx !== undefined) buckets[idx].count += 1;
  }

  return buckets;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/review-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/review-stats.ts tests/review-stats.test.ts
git commit -m "feat(review-stats): buildForecast (7 days, overdue folds into today)"
```

---

## Task 6: `computeReviewStats` — the public entry point

**Files:**
- Modify: `lib/review-stats.ts`
- Modify: `tests/review-stats.test.ts`

**Interfaces:**
- Consumes: all Task 2–5 helpers.
- Produces: `function computeReviewStats(inbox: Inbox, now?: number): ReviewStats`

- [ ] **Step 1: Write the failing test**

Append to `tests/review-stats.test.ts`:

```ts
import { computeReviewStats } from '../lib/review-stats';

describe('computeReviewStats', () => {
  const now = new Date('2026-07-03T09:00:00').getTime();
  const at = (iso: string) => new Date(iso).getTime();

  it('composes total, streak, heatmap, forecast, reviewedToday', () => {
    const w = word({
      review: review({
        dueAt: at('2026-07-05T09:00:00'),
        reviewLog: [log(at('2026-07-02T09:00:00')), log(at('2026-07-03T09:00:00'))],
      }),
    });
    const stats = computeReviewStats(inbox([w], []), now);

    expect(stats.totalReviews).toBe(2);
    expect(stats.reviewedToday).toBe(1);
    expect(stats.heatmap).toHaveLength(HEATMAP_DAYS);
    expect(stats.heatmap[stats.heatmap.length - 1]).toEqual({ date: '2026-07-03', count: 1 });
    expect(stats.forecast).toHaveLength(FORECAST_DAYS);
    expect(stats.forecast[2].count).toBe(1); // due 07-05 == today+2
    expect(stats.currentStreak).toBe(2);
    expect(stats.streakState).toBe('safe');
  });

  it('empty inbox: all-zero, broken', () => {
    const stats = computeReviewStats({ words: [], quotes: [] }, now);
    expect(stats.totalReviews).toBe(0);
    expect(stats.currentStreak).toBe(0);
    expect(stats.longestStreak).toBe(0);
    expect(stats.streakState).toBe('broken');
    expect(stats.reviewedToday).toBe(0);
    expect(stats.heatmap.every((c) => c.count === 0)).toBe(true);
    expect(stats.forecast.every((c) => c.count === 0)).toBe(true);
  });

  it('reviewedToday equals the heatmap final cell (includes archived)', () => {
    const w = word({
      status: 'archived',
      review: review({ reviewLog: [log(at('2026-07-03T10:00:00'))] }),
    });
    const stats = computeReviewStats(inbox([w], []), now);
    expect(stats.reviewedToday).toBe(1);
    expect(stats.heatmap[stats.heatmap.length - 1].count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/review-stats.test.ts`
Expected: FAIL — `computeReviewStats` is not exported.

- [ ] **Step 3: Implement `computeReviewStats`**

Add to `lib/review-stats.ts`:

```ts
export function computeReviewStats(inbox: Inbox, now = Date.now()): ReviewStats {
  const states = collectReviewStates(inbox);
  const dayCounts = reviewDayCounts(states);
  const today = localDayKey(now);
  const { current, longest, state } = computeStreak(dayCounts, today);

  let totalReviews = 0;
  for (const s of states) totalReviews += s.reviewLog?.length ?? 0;

  return {
    totalReviews,
    currentStreak: current,
    longestStreak: longest,
    streakState: state,
    reviewedToday: dayCounts.get(today) ?? 0,
    heatmap: buildHeatmap(dayCounts, now, HEATMAP_DAYS),
    forecast: buildForecast(states, now, FORECAST_DAYS),
  };
}
```

- [ ] **Step 4: Run full module test + compile**

Run: `npx vitest run tests/review-stats.test.ts tests/local-day.test.ts && npm run compile`
Expected: PASS; `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/review-stats.ts tests/review-stats.test.ts
git commit -m "feat(review-stats): computeReviewStats public entry point"
```

---

## Task 7: i18n keys (`tab.stats` + `stats.*`)

**Files:**
- Modify: `lib/i18n.ts` (add to both `messages.en` and `messages['zh-CN']`)
- Verify: `tests/i18n-source.test.ts` (existing — do not edit)

**Interfaces:**
- Produces: new `MessageKey`s: `tab.stats`, `stats.streakUnit`, `stats.best`, `stats.safeReviewed`, `stats.safeReviewToday`, `stats.atRisk`, `stats.broken`, `stats.today`, `stats.activity`, `stats.forecast`, `stats.nothingScheduled`, `stats.totalReviews`, `stats.heatmapCell`.

- [ ] **Step 1: Run the parity test to confirm it is currently green**

Run: `npx vitest run tests/i18n-source.test.ts`
Expected: PASS (baseline).

- [ ] **Step 2: Add the English keys**

In `lib/i18n.ts`, inside the `en: { … }` object, after the `'tab.quotes'` line add:

```ts
    'tab.stats': 'Stats',
```

Then, after the `'srs.retention'` line (keep the `stats.*` block together), add:

```ts
    'stats.streakUnit': 'day streak',
    'stats.best': 'Best: {n} days',
    'stats.safeReviewed': 'Reviewed today — streak safe.',
    'stats.safeReviewToday': 'Review today to keep your {n}-day streak.',
    'stats.atRisk': 'Freeze used — review today or lose your {n}-day streak.',
    'stats.broken': 'Start a new streak today.',
    'stats.today': '{reviewed} reviewed · {dueNow} due now · {dueLater} due later',
    'stats.activity': 'Activity (12 weeks)',
    'stats.forecast': 'Coming due (7 days)',
    'stats.nothingScheduled': 'Nothing scheduled',
    'stats.totalReviews': '{n} reviews all-time',
    'stats.heatmapCell': '{date}: {n} reviews',
```

- [ ] **Step 3: Add the matching zh-CN keys**

In the `'zh-CN': { … }` object, after its `'tab.quotes'` line add:

```ts
    'tab.stats': '统计',
```

Then, after its `'srs.retention'` line add:

```ts
    'stats.streakUnit': '天连续',
    'stats.best': '最佳：{n} 天',
    'stats.safeReviewed': '今天已复习——连续记录稳了。',
    'stats.safeReviewToday': '今天复习，保持 {n} 天连续记录。',
    'stats.atRisk': '已用缓冲——今天复习，否则将失去 {n} 天连续记录。',
    'stats.broken': '今天开启新的连续记录。',
    'stats.today': '已复习 {reviewed} · 待复习 {dueNow} · 稍后 {dueLater}',
    'stats.activity': '活动（12 周）',
    'stats.forecast': '即将到期（7 天）',
    'stats.nothingScheduled': '暂无安排',
    'stats.totalReviews': '累计 {n} 次复习',
    'stats.heatmapCell': '{date}：{n} 次复习',
```

- [ ] **Step 4: Run parity + compile**

Run: `npx vitest run tests/i18n-source.test.ts && npm run compile`
Expected: PASS — `en` and `zh-CN` key sets are equal; types compile.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts
git commit -m "feat(i18n): add tab.stats + stats.* keys in en and zh-CN"
```

---

## Task 8: `ReviewStatsTab` component

**Files:**
- Create: `entrypoints/dashboard/components/ReviewStatsTab.tsx`
- Test: `tests/review-stats-tab.test.tsx` (new)

**Interfaces:**
- Consumes: `ReviewStats` (Task 2), `SrsStats` from `lib/srs.ts`, `UiLocale`, `t`/`formatMessage` from `lib/i18n.ts`.
- Produces: `function ReviewStatsTab({ stats, srsStats, locale }: { stats: ReviewStats; srsStats: SrsStats; locale: UiLocale }): JSX.Element`
  - Renders `[data-testid="heat-cell"]` × `stats.heatmap.length` and `[data-testid="forecast-bar"]` × `stats.forecast.length`.

- [ ] **Step 1: Write the failing test**

Create `tests/review-stats-tab.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReviewStatsTab } from '../entrypoints/dashboard/components/ReviewStatsTab';
import type { ReviewStats } from '../lib/review-stats';
import type { SrsStats } from '../lib/srs';

function makeStats(overrides: Partial<ReviewStats> = {}): ReviewStats {
  return {
    totalReviews: 1234,
    currentStreak: 5,
    longestStreak: 9,
    streakState: 'safe',
    reviewedToday: 3,
    heatmap: Array.from({ length: 84 }, (_, i) => ({
      date: `d${i}`,
      count: i % 4,
    })),
    forecast: Array.from({ length: 7 }, (_, i) => ({ date: `2026-07-0${i + 1}`, count: i })),
    ...overrides,
  };
}

function makeSrs(overrides: Partial<SrsStats> = {}): SrsStats {
  return { dueNow: 2, dueLaterToday: 4, newAvailableToday: 1, reviewedToday: 3, retention: null, ...overrides };
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

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

describe('ReviewStatsTab', () => {
  it('renders 84 heatmap cells and 7 forecast bars', async () => {
    await render(<ReviewStatsTab stats={makeStats()} srsStats={makeSrs()} locale="en" />);
    expect(container.querySelectorAll('[data-testid="heat-cell"]')).toHaveLength(84);
    expect(container.querySelectorAll('[data-testid="forecast-bar"]')).toHaveLength(7);
  });

  it('safe + reviewed today: shows the "streak safe" headline', async () => {
    await render(<ReviewStatsTab stats={makeStats({ streakState: 'safe', reviewedToday: 3 })} srsStats={makeSrs()} locale="en" />);
    expect(container.textContent).toContain('Reviewed today — streak safe.');
  });

  it('safe + not yet today: shows the "review today to keep" headline', async () => {
    await render(<ReviewStatsTab stats={makeStats({ streakState: 'safe', reviewedToday: 0, currentStreak: 5 })} srsStats={makeSrs({ reviewedToday: 0 })} locale="en" />);
    expect(container.textContent).toContain('Review today to keep your 5-day streak.');
  });

  it('at-risk: shows the freeze-used headline', async () => {
    await render(<ReviewStatsTab stats={makeStats({ streakState: 'at-risk', reviewedToday: 0, currentStreak: 5 })} srsStats={makeSrs({ reviewedToday: 0 })} locale="en" />);
    expect(container.textContent).toContain('Freeze used — review today or lose your 5-day streak.');
  });

  it('broken / zero streak: shows the start-a-streak CTA', async () => {
    await render(<ReviewStatsTab stats={makeStats({ streakState: 'broken', currentStreak: 0, reviewedToday: 0 })} srsStats={makeSrs({ reviewedToday: 0 })} locale="en" />);
    expect(container.textContent).toContain('Start a new streak today.');
  });

  it('renders "Nothing scheduled" when the whole forecast is zero', async () => {
    const flat = makeStats({ forecast: Array.from({ length: 7 }, (_, i) => ({ date: `2026-07-0${i + 1}`, count: 0 })) });
    await render(<ReviewStatsTab stats={flat} srsStats={makeSrs()} locale="en" />);
    expect(container.textContent).toContain('Nothing scheduled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/review-stats-tab.test.tsx`
Expected: FAIL — cannot find `ReviewStatsTab`.

- [ ] **Step 3: Implement the component**

Create `entrypoints/dashboard/components/ReviewStatsTab.tsx`:

```tsx
import { Flame } from 'lucide-react';
import { formatMessage, t } from '@/lib/i18n';
import type { DayCount, ReviewStats } from '@/lib/review-stats';
import type { SrsStats } from '@/lib/srs';
import type { UiLocale } from '@/lib/types';

const HEATMAP_ROWS = 7;

function heatClass(count: number): string {
  if (count <= 0) return 'bg-paper-input';
  if (count < 3) return 'bg-accent-tint';
  if (count < 6) return 'bg-accent-wash';
  if (count < 10) return 'bg-accent';
  return 'bg-accent-deep';
}

function streakLine(stats: ReviewStats, locale: UiLocale): string {
  if (stats.streakState === 'broken' || stats.currentStreak === 0) {
    return t(locale, 'stats.broken');
  }
  if (stats.streakState === 'at-risk') {
    return formatMessage(locale, 'stats.atRisk', { n: stats.currentStreak });
  }
  // safe
  if (stats.reviewedToday > 0) return t(locale, 'stats.safeReviewed');
  return formatMessage(locale, 'stats.safeReviewToday', { n: stats.currentStreak });
}

function weekdayLabel(dateKey: string, locale: UiLocale): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(y, m - 1, d));
}

export function ReviewStatsTab({
  stats,
  srsStats,
  locale,
}: {
  stats: ReviewStats;
  srsStats: SrsStats;
  locale: UiLocale;
}) {
  const maxForecast = Math.max(1, ...stats.forecast.map((c) => c.count));
  const forecastEmpty = stats.forecast.every((c) => c.count === 0);

  return (
    <div className="space-y-5">
      {/* Streak hero */}
      <section className="rounded-2xl border border-border bg-card-soft p-5 text-center shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
        <div className="flex items-center justify-center gap-2">
          <Flame className="h-8 w-8 text-accent-deep" aria-hidden="true" />
          <span className="text-5xl font-bold leading-none text-accent-strong">
            {stats.currentStreak}
          </span>
        </div>
        <div className="mt-1 text-sm tracking-[1px] text-muted">
          {t(locale, 'stats.streakUnit')}
        </div>
        <p className="mt-3 text-sm text-ink-secondary">{streakLine(stats, locale)}</p>
        <p className="mt-1 text-xs text-muted">
          {formatMessage(locale, 'stats.best', { n: stats.longestStreak })}
        </p>
      </section>

      {/* Today */}
      <section className="rounded-2xl border border-border-soft bg-paper-light px-4 py-3 text-sm text-ink-secondary">
        {formatMessage(locale, 'stats.today', {
          reviewed: srsStats.reviewedToday,
          dueNow: srsStats.dueNow,
          dueLater: srsStats.dueLaterToday,
        })}
      </section>

      {/* Activity heatmap */}
      <section className="rounded-2xl border border-border bg-card-soft p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
        <h3 className="mb-3 text-xs font-medium tracking-[1px] text-muted">
          {t(locale, 'stats.activity')}
        </h3>
        <div
          className="grid grid-flow-col gap-1"
          style={{ gridTemplateRows: `repeat(${HEATMAP_ROWS}, minmax(0, 1fr))` }}
        >
          {stats.heatmap.map((cell: DayCount) => (
            <div
              key={cell.date}
              data-testid="heat-cell"
              title={formatMessage(locale, 'stats.heatmapCell', { date: cell.date, n: cell.count })}
              aria-label={formatMessage(locale, 'stats.heatmapCell', { date: cell.date, n: cell.count })}
              className={`h-3 w-3 rounded-[3px] ${heatClass(cell.count)}`}
            />
          ))}
        </div>
      </section>

      {/* 7-day forecast */}
      <section className="rounded-2xl border border-border bg-card-soft p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
        <h3 className="mb-3 text-xs font-medium tracking-[1px] text-muted">
          {t(locale, 'stats.forecast')}
        </h3>
        <div className="flex items-end justify-between gap-2" style={{ height: '96px' }}>
          {stats.forecast.map((cell: DayCount) => (
            <div key={cell.date} data-testid="forecast-bar" className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[11px] text-ink-secondary">{cell.count}</span>
              <div
                className="w-full rounded-t bg-accent"
                style={{ height: `${Math.round((cell.count / maxForecast) * 64) + 2}px` }}
              />
              <span className="text-[10px] text-muted">{weekdayLabel(cell.date, locale)}</span>
            </div>
          ))}
        </div>
        {forecastEmpty && (
          <p className="mt-2 text-center text-xs text-muted">{t(locale, 'stats.nothingScheduled')}</p>
        )}
      </section>

      {/* Total reviews */}
      <p className="text-center text-xs text-muted">
        {formatMessage(locale, 'stats.totalReviews', { n: stats.totalReviews.toLocaleString(locale) })}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/review-stats-tab.test.tsx && npm run compile`
Expected: PASS; compile clean.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/dashboard/components/ReviewStatsTab.tsx tests/review-stats-tab.test.tsx
git commit -m "feat(dashboard): ReviewStatsTab — hero, today, heatmap, forecast, total"
```

---

## Task 9: Wire the Stats tab into the dashboard + version bump

**Files:**
- Modify: `entrypoints/dashboard/App.tsx` (lines 43, ~132–141, ~378–394, ~396–415, ~419–444, ~489–493)
- Modify: `package.json` (line 5)

**Interfaces:**
- Consumes: `computeReviewStats` (Task 6), `ReviewStatsTab` (Task 8), existing `srsStats` and `reviewNow`.
- Produces: a working fourth tab. No new exported API.

- [ ] **Step 1: Add imports**

In `entrypoints/dashboard/App.tsx`, after the existing `QuoteList` import (line 30) add:

```tsx
import { ReviewStatsTab } from './components/ReviewStatsTab';
```

And after the `@/lib/tags` import (line 41) add:

```tsx
import { computeReviewStats } from '@/lib/review-stats';
```

- [ ] **Step 2: Extend the `Tab` union**

Change line 43 from:

```tsx
type Tab = 'review' | 'words' | 'quotes';
```

to:

```tsx
type Tab = 'review' | 'words' | 'quotes' | 'stats';
```

- [ ] **Step 3: Add the `reviewStats` memo**

Immediately after the `srsStats` assignment (line 141, `const srsStats: SrsStats = srsSnapshot.stats;`), add:

```tsx
  const reviewStats = useMemo(
    () => computeReviewStats(inbox, reviewNow),
    [inbox, reviewNow],
  );
```

- [ ] **Step 4: Add the Stats tab button (no count)**

Change the tab array (line 378) from:

```tsx
              {(['review', 'words', 'quotes'] as Tab[]).map((nextTab) => (
```

to:

```tsx
              {(['review', 'words', 'quotes', 'stats'] as Tab[]).map((nextTab) => (
```

Then update `getTabLabel` (lines 489–493) to handle `'stats'` (no count) and narrow the `counts` type:

```tsx
function getTabLabel(
  tab: Tab,
  counts: { review: number; words: number; quotes: number },
  locale: UiLocale,
): string {
  if (tab === 'stats') return t(locale, 'tab.stats');
  if (tab === 'review') return `${t(locale, 'tab.review')} (${counts.review})`;
  if (tab === 'words') return `${t(locale, 'tab.words')} (${counts.words})`;
  return `${t(locale, 'tab.quotes')} (${counts.quotes})`;
}
```

- [ ] **Step 5: Hide the status-filter control on the Stats tab**

The right-hand control block (lines 396–415) currently is `tab === 'review' ? <badge> : <select>`. Change the outer condition so `'stats'` renders nothing. Replace line 396:

```tsx
            {tab === 'review' ? (
```

with:

```tsx
            {tab === 'stats' ? null : tab === 'review' ? (
```

(The existing `<div>…</div> ) : ( <label>…</label> )` bodies stay unchanged.)

- [ ] **Step 6: Add the `tab === 'stats'` render branch**

Change the `<section>` render chain (lines 420–443). Replace the opening of the ternary (line 420):

```tsx
          {tab === 'review' ? (
```

with:

```tsx
          {tab === 'stats' ? (
            <ReviewStatsTab stats={reviewStats} srsStats={srsStats} locale={locale} />
          ) : tab === 'review' ? (
```

(The rest of the chain — `ReviewQueue` / `WordList` / `QuoteList` — is unchanged.)

- [ ] **Step 7: Bump the version**

In `package.json` change line 5 from:

```json
  "version": "0.3.0",
```

to:

```json
  "version": "0.4.0",
```

- [ ] **Step 8: Compile and run the full suite**

Run: `npm run compile && npm test`
Expected: `tsc --noEmit` clean; all tests green (including `tests/dashboard-access.test.ts`, `tests/i18n-source.test.ts`, and the three new files).

- [ ] **Step 9: Commit**

```bash
git add entrypoints/dashboard/App.tsx package.json
git commit -m "feat(dashboard): add Stats tab wired to computeReviewStats; bump to 0.4.0"
```

---

## Task 10: Final verification & manual smoke check

**Files:** none (verification only)

- [ ] **Step 1: Full green gate**

Run: `npm run compile && npm test`
Expected: both clean. If anything fails, use `superpowers:systematic-debugging` before proceeding — do not claim completion on red.

- [ ] **Step 2: Manual smoke check (recommended)**

Run: `npm run dev`, open the dashboard, click the **Stats** tab. Confirm: streak hero renders; the state line matches your review history; the heatmap shows 84 cells (12×7) with today shaded to match "Reviewed today"; the forecast shows 7 weekday bars (or "Nothing scheduled" when empty); the total footnote reads sensibly. Toggle language in Settings and confirm zh-CN strings render.

- [ ] **Step 3: Finish the branch**

Use `superpowers:finishing-a-development-branch`. Per recorded preference, integrate by **merging to `master` locally and NOT auto-pushing** (see memory: branch-integration-preference).

---

## Self-Review

**Spec coverage:**
- Stats tab in dashboard alongside Review/Words/Quotes → Task 9 (`Tab` union, tab button, render branch).
- Current streak hero + longest (personal best) → Task 3 (`computeStreak`), Task 8 (hero + `stats.best`).
- Today CTA line (4 states) → Task 8 (`streakLine`), Task 7 (`stats.safeReviewed/safeReviewToday/atRisk/broken`).
- 12-week (84-day) heatmap, GitHub-style, ramped shading, per-cell title → Task 4 (`buildHeatmap`), Task 8 (grid + `heatClass` + `stats.heatmapCell`).
- 7-day forecast, overdue-folds-into-today, "Nothing scheduled" empty state → Task 5 (`buildForecast`), Task 8 (bars + caption).
- Lifetime total reviews → Task 6 (`totalReviews`), Task 8 (`stats.totalReviews`).
- "Today" line reusing `SrsStats` (reviewed/dueNow/dueLater) → Task 8 (`stats.today`), no recomputation.
- en/zh-CN parity → Task 7 (both tables) + existing `tests/i18n-source.test.ts`.
- One shared local-day helper, existing code changed once → Task 1 (export `startOfDay`, add `localDayKey`).
- No storage/sync/permission/migration changes; no charting library → Global Constraints; module is pure; component is hand-rolled.
- Testing: pure module matrix (`tests/review-stats.test.ts`), DOM tab tests (`tests/review-stats-tab.test.tsx`), i18n parity kept green, full regression → Tasks 2–10.

**Deviations from the spec (intentional, per findings):**
- Heatmap ramps through `accent-*` tokens, not `cinnabar` (token removed).
- Interpolated strings use `formatMessage`, not `t`.
- `reviewDayCounts(states)` drops the unused `now` parameter the spec sketched.
- `buildForecast` counts every collected `ReviewState` by `dueAt`; "new/unscheduled" exclusion happens upstream in `collectReviewStates` (cards with no `ReviewState`), matching the type system (every `ReviewState` has a `dueAt`).
- Version bumped to 0.4.0 (repo already past the spec's v0.2.2).

**Placeholder scan:** none — every code step contains full source; every command has an expected result.

**Type consistency:** `computeStreak` returns `{ current, longest, state }`, mapped to `currentStreak`/`longestStreak`/`streakState` in `computeReviewStats` (Task 6). `DayCount`/`StreakState`/`ReviewStats` defined once (Task 2) and imported by later tasks. `ReviewStatsTab` props (`stats`, `srsStats`, `locale`) match the App call site (Task 9). `heatClass`/`weekdayLabel`/`streakLine` names are consistent between component and test.
