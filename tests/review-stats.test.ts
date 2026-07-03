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
