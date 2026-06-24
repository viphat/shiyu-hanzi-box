import { describe, expect, it } from 'vitest';
import type {
  AppSettings,
  ReviewCardState,
  ReviewLogEntry,
  ReviewRating,
  ReviewScheduler,
  ReviewState,
} from '../lib/types';

describe('SRS persisted types', () => {
  it('exposes FSRS review enums and shapes', () => {
    const scheduler: ReviewScheduler = 'fsrs-v1';
    const cardState: ReviewCardState = 'new';
    const rating: ReviewRating = 'again';

    const review: ReviewState = {
      scheduler,
      dueAt: 1,
      intervalDays: 0,
      repetitions: 0,
      lapses: 0,
      cardState,
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 1,
      retrievability: 0.9,
      reviewLog: [
        {
          reviewedAt: 1,
          rating,
          elapsedDays: 0,
          scheduledDays: 1,
          stateBefore: 'new',
          stateAfter: 'review',
          stabilityBefore: 0,
          stabilityAfter: 1,
          difficultyBefore: 5,
          difficultyAfter: 5,
        },
      ],
    };

    expect(review.scheduler).toBe('fsrs-v1');
    expect(review.reviewLog).toHaveLength(1);
  });

  it('keeps ReviewState backward compatible without FSRS fields', () => {
    const legacy: ReviewState = {
      dueAt: 1,
      intervalDays: 1,
      repetitions: 1,
      lapses: 0,
    };
    expect(legacy.scheduler).toBeUndefined();
  });

  it('adds an srs block to AppSettings', () => {
    const settings: AppSettings = {
      uiLocale: 'zh-CN',
      kaikki: {
        enabled: false,
        sourceUrl: '',
        sourceName: '',
        hash: null,
        entryCount: 0,
        importedAt: null,
      },
      srs: {
        desiredRetention: 0.9,
        maximumIntervalDays: 3650,
        newCardsPerDay: 20,
        enableFuzz: true,
      },
    };
    expect(settings.srs.desiredRetention).toBe(0.9);
  });
});
