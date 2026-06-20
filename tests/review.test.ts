import { describe, expect, it } from 'vitest';
import type { Inbox, QuoteEntry, WordEntry } from '../lib/types';
import {
  buildReviewQueue,
  repeatReview,
  skipReview,
  viewReview,
} from '../lib/review';

const NOW = new Date('2026-06-20T10:30:00').getTime();
const YESTERDAY = new Date('2026-06-19T08:00:00').getTime();
const TOMORROW_START = new Date('2026-06-21T00:00:00').getTime();
const THREE_DAYS_START = new Date('2026-06-23T00:00:00').getTime();

function word(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'word-1',
    kind: 'word',
    text: '山水',
    normalized: '山水',
    tags: [],
    note: '',
    status: 'inbox',
    createdAt: YESTERDAY,
    updatedAt: YESTERDAY,
    occurrences: [
      {
        sourceTitle: 'Poem',
        sourceUrl: 'https://example.com/poem',
        sourceDomain: 'example.com',
        surrounding: '山水有清音',
        capturedAt: YESTERDAY,
      },
    ],
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'quote-1',
    kind: 'quote',
    text: '山水有清音',
    tags: [],
    note: '',
    status: 'reviewed',
    createdAt: YESTERDAY,
    updatedAt: YESTERDAY,
    category: 'poetry',
    sourceTitle: 'Poem',
    sourceUrl: 'https://example.com/poem',
    sourceDomain: 'example.com',
    surrounding: '山水有清音',
    ...overrides,
  };
}

describe('buildReviewQueue', () => {
  it('returns due words and quotes for today and excludes archived entries', () => {
    const inbox: Inbox = {
      words: [
        word({ id: 'due-word', createdAt: YESTERDAY }),
        word({ id: 'archived-word', status: 'archived' }),
        word({
          id: 'future-word',
          review: {
            dueAt: THREE_DAYS_START,
            intervalDays: 3,
            repetitions: 1,
            lapses: 0,
          },
        }),
      ],
      quotes: [
        quote({
          id: 'due-quote',
          review: {
            dueAt: NOW,
            intervalDays: 1,
            repetitions: 1,
            lapses: 0,
          },
        }),
      ],
    };

    expect(buildReviewQueue(inbox, NOW).map((item) => item.entry.id)).toEqual([
      'due-word',
      'due-quote',
    ]);
  });

  it('places repeated cards after the rest of today queue', () => {
    const inbox: Inbox = {
      words: [
        word({
          id: 'repeat-me',
          review: {
            dueAt: YESTERDAY,
            intervalDays: 0,
            repetitions: 0,
            lapses: 1,
            queueRank: NOW,
          },
        }),
        word({ id: 'fresh-due', createdAt: YESTERDAY + 1000 }),
      ],
      quotes: [
        quote({
          id: 'already-repeated',
          review: {
            dueAt: YESTERDAY,
            intervalDays: 0,
            repetitions: 0,
            lapses: 1,
            queueRank: NOW + 1,
          },
        }),
      ],
    };

    expect(buildReviewQueue(inbox, NOW).map((item) => item.entry.id)).toEqual([
      'fresh-due',
      'repeat-me',
      'already-repeated',
    ]);
  });
});

describe('review actions', () => {
  it('View moves an entry into spaced repetition and schedules the next interval', () => {
    const next = viewReview(word(), NOW);

    expect(next.status).toBe('reviewed');
    expect(next.review).toMatchObject({
      dueAt: TOMORROW_START,
      intervalDays: 1,
      repetitions: 1,
      lapses: 0,
      lastReviewedAt: NOW,
    });
    expect(next.updatedAt).toBe(NOW);
  });

  it('View advances the interval for an already reviewed entry', () => {
    const next = viewReview(
      quote({
        review: {
          dueAt: NOW,
          intervalDays: 1,
          repetitions: 1,
          lapses: 0,
        },
      }),
      NOW,
    );

    expect(next.review).toMatchObject({
      dueAt: THREE_DAYS_START,
      intervalDays: 3,
      repetitions: 2,
      lapses: 0,
      lastReviewedAt: NOW,
    });
  });

  it('Skip postpones until tomorrow without counting as a review', () => {
    const next = skipReview(
      quote({
        review: {
          dueAt: YESTERDAY,
          intervalDays: 1,
          repetitions: 2,
          lapses: 0,
          lastReviewedAt: YESTERDAY,
          queueRank: NOW,
        },
      }),
      NOW,
    );

    expect(next.status).toBe('reviewed');
    expect(next.review).toMatchObject({
      dueAt: TOMORROW_START,
      intervalDays: 1,
      repetitions: 2,
      lapses: 0,
      lastReviewedAt: YESTERDAY,
    });
    expect(next.review?.queueRank).toBeUndefined();
  });

  it('Repeat keeps the entry due today and moves it to the end of the queue', () => {
    const next = repeatReview(word(), NOW, NOW + 20);

    expect(next.status).toBe('reviewed');
    expect(next.review).toMatchObject({
      dueAt: NOW,
      intervalDays: 0,
      repetitions: 0,
      lapses: 1,
      queueRank: NOW + 20,
    });
  });
});
