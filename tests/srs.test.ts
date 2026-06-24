import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SRS_SETTINGS,
  createSrsScheduler,
  migrateReviewState,
  RATING_TO_GRADE,
  toFsrsCard,
} from '../lib/srs';
import type { SrsSettings, WordEntry } from '../lib/types';

const NOW = new Date('2026-06-24T10:30:00').getTime();
const YESTERDAY = new Date('2026-06-23T08:00:00').getTime();

const NO_FUZZ: SrsSettings = { ...DEFAULT_SRS_SETTINGS, enableFuzz: false };

function word(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'word-1',
    kind: 'word',
    text: '山水',
    normalized: '山水',
    note: '',
    status: 'inbox',
    createdAt: YESTERDAY,
    updatedAt: YESTERDAY,
    occurrences: [],
    ...overrides,
  };
}

describe('createSrsScheduler', () => {
  it('builds an FSRS scheduler from SRS settings', () => {
    const scheduler = createSrsScheduler(NO_FUZZ);
    const params = scheduler.parameters;
    expect(params.request_retention).toBe(0.9);
    expect(params.maximum_interval).toBe(3650);
    expect(params.enable_fuzz).toBe(false);
  });

  it('honors a custom desired retention and max interval', () => {
    const scheduler = createSrsScheduler({
      ...NO_FUZZ,
      desiredRetention: 0.85,
      maximumIntervalDays: 1000,
    });
    expect(scheduler.parameters.request_retention).toBe(0.85);
    expect(scheduler.parameters.maximum_interval).toBe(1000);
  });
});

describe('RATING_TO_GRADE', () => {
  it('maps UI ratings to FSRS grades excluding Manual', () => {
    expect(RATING_TO_GRADE.again).toBe(1);
    expect(RATING_TO_GRADE.hard).toBe(2);
    expect(RATING_TO_GRADE.good).toBe(3);
    expect(RATING_TO_GRADE.easy).toBe(4);
  });
});

describe('migrateReviewState', () => {
  it('initializes an entry with no review as an FSRS new card due at createdAt', () => {
    const entry = word();
    const migrated = migrateReviewState(entry, NOW);

    expect(migrated.review?.scheduler).toBe('fsrs-v1');
    expect(migrated.review?.cardState).toBe('new');
    expect(migrated.review?.dueAt).toBe(YESTERDAY);
    expect(migrated.review?.repetitions).toBe(0);
    expect(migrated.review?.lapses).toBe(0);
    expect(migrated.review?.learningSteps).toBe(0);
    expect(migrated.review?.stability).toBeUndefined();
    expect(migrated.review?.difficulty).toBeUndefined();
  });

  it('leaves an already-fsrs entry unchanged (idempotent)', () => {
    const entry = word({
      review: {
        scheduler: 'fsrs-v1',
        dueAt: NOW,
        intervalDays: 3,
        repetitions: 2,
        lapses: 0,
        cardState: 'review',
        stability: 5,
        difficulty: 5,
      },
    });
    const migrated = migrateReviewState(entry, NOW);
    expect(migrated.review).toEqual(entry.review);
  });

  it('migrates an old fixed-ladder review into an FSRS review card preserving the due date', () => {
    const entry = word({
      review: {
        dueAt: NOW,
        intervalDays: 7,
        repetitions: 3,
        lapses: 1,
        lastReviewedAt: YESTERDAY,
      },
    });
    const migrated = migrateReviewState(entry, NOW);

    expect(migrated.review?.scheduler).toBe('fsrs-v1');
    expect(migrated.review?.cardState).toBe('review');
    expect(migrated.review?.dueAt).toBe(NOW);
    expect(migrated.review?.repetitions).toBe(3);
    expect(migrated.review?.lapses).toBe(1);
    expect(migrated.review?.lastReviewedAt).toBe(YESTERDAY);
    expect(migrated.review?.stability).toBe(7);
    expect(migrated.review?.difficulty).toBeCloseTo(5.5, 5);
  });

  it('migrates a fixed-ladder review with zero repetitions as a new card', () => {
    const entry = word({
      review: { dueAt: NOW, intervalDays: 0, repetitions: 0, lapses: 0 },
    });
    const migrated = migrateReviewState(entry, NOW);
    expect(migrated.review?.cardState).toBe('new');
  });
});

describe('toFsrsCard', () => {
  it('converts a migrated FSRS review state into an FSRS card', () => {
    const entry = migrateReviewState(
      word({
        review: {
          dueAt: NOW,
          intervalDays: 7,
          repetitions: 3,
          lapses: 1,
          lastReviewedAt: YESTERDAY,
        },
      }),
      NOW,
    );
    const card = toFsrsCard(entry.review!);
    expect(card.state).toBe(2);
    expect(card.stability).toBe(7);
    expect(card.reps).toBe(3);
    expect(card.lapses).toBe(1);
    expect(card.learning_steps).toBe(0);
    expect(card.due.getTime()).toBe(NOW);
    expect(card.last_review?.getTime()).toBe(YESTERDAY);
  });
});
