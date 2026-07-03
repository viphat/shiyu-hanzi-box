import { describe, expect, it } from 'vitest';
import { buildHeatmap, collectReviewStates, reviewDayCounts, computeStreak, HEATMAP_DAYS, buildForecast, FORECAST_DAYS, computeReviewStats } from '../lib/review-stats';
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

  it('future-dated days do not inflate longest', () => {
    // today active, plus two future days that (unguarded) would form a run of 3
    const r = computeStreak(active('2026-07-03', '2026-07-04', '2026-07-05'), today);
    expect(r.longest).toBe(1);
    expect(r.current).toBe(1);
    expect(r.state).toBe('safe');
  });
});

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

  it('totalReviews counts archived words and cloze entries', () => {
    const w = word({ status: 'archived', review: review({ reviewLog: [log(at('2026-07-01T09:00:00')), log(at('2026-07-02T09:00:00'))] }) });
    const q = quote([{ id: 'c1', start: 0, end: 1, review: review({ reviewLog: [log(at('2026-07-02T10:00:00'))] }) }]);
    const stats = computeReviewStats(inbox([w], [q]), now);
    expect(stats.totalReviews).toBe(3);
  });
});
