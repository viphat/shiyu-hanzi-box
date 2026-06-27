import { describe, expect, it } from 'vitest';
import {
  answerReview,
  answerReviewCloze,
  buildSrsQueue,
  cardId,
  DEFAULT_SRS_SETTINGS,
  createSrsScheduler,
  getNextSrsWakeAt,
  getSrsStats,
  migrateReviewState,
  postponeReview,
  postponeReviewCloze,
  previewReview,
  previewReviewCloze,
  RATING_TO_GRADE,
  toFsrsCard,
} from '../lib/srs';
import type {
  Inbox,
  QuoteEntry,
  SrsSettings,
  WordEntry,
} from '../lib/types';

const NOW = new Date('2026-06-24T10:30:00').getTime();
const YESTERDAY = new Date('2026-06-23T08:00:00').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

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

function quote(overrides: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'quote-1',
    kind: 'quote',
    text: '学而时习之',
    tags: [],
    note: '',
    status: 'inbox',
    createdAt: YESTERDAY,
    updatedAt: YESTERDAY,
    sourceTitle: 'Analects',
    sourceUrl: 'https://example.com/analects',
    sourceDomain: 'example.com',
    surrounding: '学而时习之，不亦说乎',
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

describe('answerReview', () => {
  it('schedules different intervals for Again, Hard, Good, and Easy', () => {
    const base = migrateReviewState(word(), NOW);
    const again = answerReview(base, 'again', NOW, NO_FUZZ);
    const hard = answerReview(base, 'hard', NOW, NO_FUZZ);
    const good = answerReview(base, 'good', NOW, NO_FUZZ);
    const easy = answerReview(base, 'easy', NOW, NO_FUZZ);

    const due = (entry: WordEntry) => entry.review?.dueAt ?? 0;
    expect(due(again)).toBeLessThanOrEqual(due(hard));
    expect(due(hard)).toBeLessThan(due(good));
    expect(due(good)).toBeLessThan(due(easy));
  });

  it('persists card state, stability, difficulty, interval, and review log', () => {
    const base = migrateReviewState(word(), NOW);
    const next = answerReview(base, 'good', NOW, NO_FUZZ);
    const review = next.review!;
    expect(review.scheduler).toBe('fsrs-v1');
    expect(review.cardState).toBeDefined();
    expect(review.stability).toBeGreaterThan(0);
    expect(review.difficulty).toBeGreaterThanOrEqual(1);
    expect(review.dueAt).toBeGreaterThan(NOW);
    expect(review.learningSteps).toBe(1);
    expect(review.lastReviewedAt).toBe(NOW);
    expect(review.reviewLog).toHaveLength(1);
    expect(review.reviewLog![0].rating).toBe('good');
    expect(review.reviewLog![0].stateBefore).toBe('new');
  });

  it('is deterministic with fuzz disabled', () => {
    const base = migrateReviewState(word(), NOW);
    const a = answerReview(base, 'good', NOW, NO_FUZZ);
    const b = answerReview(base, 'good', NOW, NO_FUZZ);
    expect(a.review?.dueAt).toBe(b.review?.dueAt);
    expect(a.review?.stability).toBe(b.review?.stability);
  });

  it('round-trips learning step progress so the next Good graduates the card', () => {
    const first = answerReview(
      migrateReviewState(word(), NOW),
      'good',
      NOW,
      NO_FUZZ,
    );
    expect(first.review).toMatchObject({
      cardState: 'learning',
      learningSteps: 1,
    });

    const secondNow = first.review!.dueAt;
    const second = answerReview(first, 'good', secondNow, NO_FUZZ);

    expect(second.review).toMatchObject({
      cardState: 'review',
      learningSteps: 0,
    });
    expect(second.review!.dueAt).toBeGreaterThan(secondNow);
  });

  it('migrates an old fixed-ladder entry before answering', () => {
    const entry = word({
      review: {
        dueAt: NOW,
        intervalDays: 7,
        repetitions: 3,
        lapses: 0,
        lastReviewedAt: YESTERDAY,
      },
    });
    const next = answerReview(entry, 'good', NOW, NO_FUZZ);
    expect(next.review?.scheduler).toBe('fsrs-v1');
    expect(next.review?.reviewLog).toHaveLength(1);
    expect(next.review?.reviewLog![0].stateBefore).toBe('review');
  });

  it('Again re-shows the card sooner than Good', () => {
    const base = migrateReviewState(word(), NOW);
    const good = answerReview(base, 'good', NOW, NO_FUZZ);
    const again = answerReview(base, 'again', NOW, NO_FUZZ);
    expect(again.review!.dueAt).toBeLessThanOrEqual(good.review!.dueAt);
  });

  it('Answering Again on a settled review card increments lapses', () => {
    const settled = migrateReviewState(
      word({
        review: {
          scheduler: 'fsrs-v1',
          dueAt: NOW - 1,
          intervalDays: 14,
          repetitions: 4,
          lapses: 0,
          cardState: 'review',
          stability: 14,
          difficulty: 5,
          lastReviewedAt: NOW - 14 * DAY_MS,
        },
      }),
      NOW,
    );
    const before = settled.review!.lapses;
    const forgot = answerReview(settled, 'again', NOW, NO_FUZZ);
    expect(forgot.review!.lapses).toBeGreaterThan(before);
    expect(['learning', 'relearning', 'review']).toContain(
      forgot.review?.cardState,
    );
  });
});

describe('previewReview', () => {
  it('returns a preview entry for each of the four ratings', () => {
    const base = migrateReviewState(word(), NOW);
    const preview = previewReview(base, NOW, NO_FUZZ);
    expect(Object.keys(preview).sort()).toEqual([
      'again',
      'easy',
      'good',
      'hard',
    ]);
    expect(preview.good.dueAt).toBeGreaterThan(preview.again.dueAt);
  });
});

describe('postponeReview', () => {
  it('changes the due date without changing memory state or adding a log', () => {
    const base = answerReview(
      migrateReviewState(word(), NOW),
      'good',
      NOW,
      NO_FUZZ,
    );
    const before = { ...base.review! };
    const postponed = postponeReview(base, NOW, NOW + 5 * DAY_MS);
    const after = postponed.review!;

    expect(after.dueAt).toBe(NOW + 5 * DAY_MS);
    expect(after.scheduler).toBe('fsrs-v1');
    expect(after.stability).toBe(before.stability);
    expect(after.difficulty).toBe(before.difficulty);
    expect(after.repetitions).toBe(before.repetitions);
    expect(after.lapses).toBe(before.lapses);
    expect(after.cardState).toBe(before.cardState);
    expect(after.scheduledDays).toBe(5);
    expect(after.reviewLog).toBe(before.reviewLog);
    expect(after.queueRank).toBeUndefined();
    expect(postponed.updatedAt).toBe(NOW);
  });

  it('migrates and persists a never-reviewed entry as an fsrs new card on postpone', () => {
    const postponed = postponeReview(word(), NOW, NOW + DAY_MS);
    const review = postponed.review!;
    expect(review.scheduler).toBe('fsrs-v1');
    expect(review.cardState).toBe('new');
    expect(review.repetitions).toBe(0);
    expect(review.lapses).toBe(0);
    expect(review.stability).toBeUndefined();
    expect(review.dueAt).toBe(NOW + DAY_MS);
    expect(review.scheduledDays).toBe(1);
    expect(review.reviewLog).toBeUndefined();
    expect(postponed.status).toBe('inbox');
  });

  it('migrates a fixed-ladder entry before postponing', () => {
    const entry = word({
      review: {
        dueAt: NOW,
        intervalDays: 7,
        repetitions: 3,
        lapses: 0,
        lastReviewedAt: YESTERDAY,
      },
    });
    const postponed = postponeReview(entry, NOW, NOW + DAY_MS);
    expect(postponed.review?.scheduler).toBe('fsrs-v1');
    expect(postponed.review?.cardState).toBe('review');
    expect(postponed.review?.stability).toBe(7);
  });
});

describe('buildSrsQueue', () => {
  it('includes items with dueAt <= now, not end-of-day', () => {
    const laterToday = NOW + 3 * 60 * 60 * 1000;
    const inbox: Inbox = {
      words: [
        migrateReviewState(
          word({
            id: 'due-now',
            review: {
              scheduler: 'fsrs-v1',
              cardState: 'review',
              dueAt: NOW - 1,
              intervalDays: 3,
              repetitions: 2,
              lapses: 0,
              stability: 3,
              difficulty: 5,
              lastReviewedAt: YESTERDAY,
            },
          }),
        ),
        migrateReviewState(
          word({
            id: 'due-later-today',
            review: {
              scheduler: 'fsrs-v1',
              cardState: 'review',
              dueAt: laterToday,
              intervalDays: 3,
              repetitions: 2,
              lapses: 0,
              stability: 3,
              difficulty: 5,
              lastReviewedAt: YESTERDAY,
            },
          }),
        ),
      ],
      quotes: [],
    };

    const ids = buildSrsQueue(inbox, NOW, NO_FUZZ).map(
      (item) => item.entry.id,
    );
    expect(ids).toEqual(['due-now']);
  });

  it('excludes archived entries', () => {
    const inbox: Inbox = {
      words: [
        migrateReviewState(word({ id: 'a', status: 'archived' })),
      ],
      quotes: [],
    };
    expect(buildSrsQueue(inbox, NOW, NO_FUZZ)).toHaveLength(0);
  });

  it('sorts learning/relearning before long-term review', () => {
    const inbox: Inbox = {
      words: [
        migrateReviewState(
          word({
            id: 'review-card',
            review: {
              scheduler: 'fsrs-v1',
              cardState: 'review',
              dueAt: NOW - 100,
              intervalDays: 3,
              repetitions: 2,
              lapses: 0,
              stability: 3,
              difficulty: 5,
              lastReviewedAt: YESTERDAY,
            },
          }),
        ),
        migrateReviewState(
          word({
            id: 'learning-card',
            review: {
              scheduler: 'fsrs-v1',
              cardState: 'learning',
              dueAt: NOW - 50,
              intervalDays: 0,
              repetitions: 0,
              lapses: 0,
              stability: 0.1,
              difficulty: 5,
              lastReviewedAt: NOW - 60_000,
            },
          }),
        ),
      ],
      quotes: [],
    };
    const ids = buildSrsQueue(inbox, NOW, NO_FUZZ).map(
      (item) => item.entry.id,
    );
    expect(ids).toEqual(['learning-card', 'review-card']);
  });

  it('caps new cards per day but never learning, relearning, or review cards', () => {
    const newWord = (id: string) => migrateReviewState(word({ id }));
    const reviewWord = (id: string) =>
      migrateReviewState(
        word({
          id,
          review: {
            scheduler: 'fsrs-v1',
            cardState: 'review',
            dueAt: NOW - 1,
            intervalDays: 3,
            repetitions: 2,
            lapses: 0,
            stability: 3,
            difficulty: 5,
            lastReviewedAt: YESTERDAY,
          },
        }),
      );

    const settings = { ...NO_FUZZ, newCardsPerDay: 1 };
    const inbox: Inbox = {
      words: [newWord('new1'), newWord('new2'), reviewWord('rev1')],
      quotes: [],
    };

    const ids = buildSrsQueue(inbox, NOW, settings).map(
      (item) => item.entry.id,
    );
    expect(ids).toContain('rev1');
    expect(ids.filter((id) => id.startsWith('new'))).toHaveLength(1);
  });

  it('sorts all due new cards globally before applying the daily cap', () => {
    const settings = { ...NO_FUZZ, newCardsPerDay: 1 };
    const inbox: Inbox = {
      words: [
        migrateReviewState(
          word({
            id: 'newer-word',
            createdAt: NOW - 1_000,
            updatedAt: NOW - 1_000,
          }),
        ),
      ],
      quotes: [
        // Use a clozed quote so it produces cards; older createdAt should win the cap slot
        quote({
          id: 'older-quote',
          createdAt: YESTERDAY,
          updatedAt: YESTERDAY,
          clozes: [{ id: 'cz-old', start: 0, end: 1, hint: 'none' }],
        }),
      ],
    };

    const ids = buildSrsQueue(inbox, NOW, settings).map(
      (item) => item.entry.id,
    );
    expect(ids).toEqual(['older-quote']);
  });

  it('does not mutate new cards hidden by the cap', () => {
    const settings = { ...NO_FUZZ, newCardsPerDay: 0 };
    const inbox: Inbox = {
      words: [migrateReviewState(word({ id: 'new1' }))],
      quotes: [],
    };
    expect(buildSrsQueue(inbox, NOW, settings)).toHaveLength(0);
    expect(inbox.words[0].review?.cardState).toBe('new');
  });
});

describe('getSrsStats', () => {
  it('counts due now, due later today, new available today, and reviewed today', () => {
    const laterToday = NOW + 3 * 60 * 60 * 1000;
    const inbox: Inbox = {
      words: [
        migrateReviewState(
          word({
            id: 'due',
            review: {
              scheduler: 'fsrs-v1',
              cardState: 'review',
              dueAt: NOW - 1,
              intervalDays: 3,
              repetitions: 2,
              lapses: 0,
              stability: 3,
              difficulty: 5,
              lastReviewedAt: YESTERDAY,
            },
          }),
        ),
        migrateReviewState(
          word({
            id: 'later',
            review: {
              scheduler: 'fsrs-v1',
              cardState: 'review',
              dueAt: laterToday,
              intervalDays: 3,
              repetitions: 2,
              lapses: 0,
              stability: 3,
              difficulty: 5,
              lastReviewedAt: YESTERDAY,
            },
          }),
        ),
      ],
      quotes: [],
    };
    const dueNow = buildSrsQueue(inbox, NOW, NO_FUZZ).length;
    const stats = getSrsStats(inbox, NOW, NO_FUZZ, dueNow);
    expect(stats.dueNow).toBe(1);
    expect(stats.dueLaterToday).toBe(1);
    expect(stats.newAvailableToday).toBe(0);
  });

  it('counts reviewed today from review logs on the current local day', () => {
    const startOfToday = new Date(
      new Date(NOW).getFullYear(),
      new Date(NOW).getMonth(),
      new Date(NOW).getDate(),
    ).getTime();
    const inbox: Inbox = {
      words: [
        migrateReviewState(
          word({
            id: 'reviewed-today',
            review: {
              scheduler: 'fsrs-v1',
              cardState: 'review',
              dueAt: NOW + DAY_MS,
              intervalDays: 3,
              repetitions: 1,
              lapses: 0,
              stability: 3,
              difficulty: 5,
              lastReviewedAt: NOW,
              reviewLog: [
                {
                  reviewedAt: startOfToday + 60_000,
                  rating: 'good',
                  elapsedDays: 0,
                  scheduledDays: 3,
                  stateBefore: 'new',
                  stateAfter: 'review',
                },
              ],
            },
          }),
        ),
      ],
      quotes: [],
    };
    const dueNow = buildSrsQueue(inbox, NOW, NO_FUZZ).length;
    expect(getSrsStats(inbox, NOW, NO_FUZZ, dueNow).reviewedToday).toBe(1);
  });

  it('caps new available today at the remaining daily capacity', () => {
    const startOfToday = new Date(
      new Date(NOW).getFullYear(),
      new Date(NOW).getMonth(),
      new Date(NOW).getDate(),
    ).getTime();
    const consumed = migrateReviewState(
      word({
        id: 'consumed',
        review: {
          scheduler: 'fsrs-v1',
          cardState: 'review',
          dueAt: NOW + DAY_MS,
          intervalDays: 1,
          repetitions: 1,
          lapses: 0,
          stability: 1,
          difficulty: 5,
          reviewLog: [
            {
              reviewedAt: startOfToday + 60_000,
              rating: 'good',
              elapsedDays: 0,
              scheduledDays: 1,
              stateBefore: 'new',
              stateAfter: 'review',
            },
          ],
        },
      }),
    );
    const inbox: Inbox = {
      words: [
        consumed,
        migrateReviewState(word({ id: 'new-1' })),
        migrateReviewState(word({ id: 'new-2' })),
        migrateReviewState(word({ id: 'new-3' })),
      ],
      quotes: [],
    };

    const settings = { ...NO_FUZZ, newCardsPerDay: 2 };
    const dueNow = buildSrsQueue(inbox, NOW, settings).length;
    expect(
      getSrsStats(inbox, NOW, settings, dueNow).newAvailableToday,
    ).toBe(1);
  });

  it('shows retention only after ten logged reviews', () => {
    const logs = Array.from({ length: 10 }, (_, index) => ({
      reviewedAt: NOW - index,
      rating: index === 0 ? ('again' as const) : ('good' as const),
      elapsedDays: 1,
      scheduledDays: 1,
      stateBefore: 'review' as const,
      stateAfter: 'review' as const,
    }));
    const withLogs = (reviewLog: typeof logs): Inbox => ({
      words: [
        migrateReviewState(
          word({
            review: {
              scheduler: 'fsrs-v1',
              cardState: 'review',
              dueAt: NOW + DAY_MS,
              intervalDays: 1,
              repetitions: reviewLog.length,
              lapses: 1,
              stability: 1,
              difficulty: 5,
              reviewLog,
            },
          }),
        ),
      ],
      quotes: [],
    });

    const beforeThreshold = withLogs(logs.slice(0, 9));
    const atThreshold = withLogs(logs);
    expect(
      getSrsStats(
        beforeThreshold,
        NOW,
        NO_FUZZ,
        buildSrsQueue(beforeThreshold, NOW, NO_FUZZ).length,
      ).retention,
    ).toBeNull();
    expect(
      getSrsStats(
        atThreshold,
        NOW,
        NO_FUZZ,
        buildSrsQueue(atThreshold, NOW, NO_FUZZ).length,
      ).retention,
    ).toBe(0.9);
  });
});

function clozedQuote(): QuoteEntry {
  return quote({
    id: 'q1',
    text: '他义无反顾地走了',
    clozes: [
      { id: 'cz1', start: 1, end: 5, hint: 'none' }, // 义无反顾
      { id: 'cz2', start: 6, end: 7, hint: 'none' }, // 走
    ],
  });
}

describe('cardId', () => {
  it('produces word:<entryId> for a word source', () => {
    expect(cardId({ kind: 'word', entryId: 'word-1' })).toBe('word:word-1');
  });

  it('produces cloze:<quoteId>:<clozeId> for a cloze source', () => {
    expect(cardId({ kind: 'cloze', quoteId: 'q1', clozeId: 'cz1' })).toBe(
      'cloze:q1:cz1',
    );
  });
});

describe('answerReviewCloze', () => {
  it('rates one cloze without affecting its sibling', () => {
    const q = clozedQuote();
    const next = answerReviewCloze(q, 'cz1', 'good', NOW, NO_FUZZ);
    const c1 = next.clozes!.find((c) => c.id === 'cz1')!;
    const c2 = next.clozes!.find((c) => c.id === 'cz2')!;
    expect(c1.review?.repetitions).toBe(1);
    expect(c2.review).toBeUndefined(); // untouched
  });

  it('sets quote status to reviewed and updatedAt to now', () => {
    const q = clozedQuote();
    const next = answerReviewCloze(q, 'cz1', 'good', NOW, NO_FUZZ);
    expect(next.status).toBe('reviewed');
    expect(next.updatedAt).toBe(NOW);
  });

  it('does not change status of archived quotes', () => {
    const q = { ...clozedQuote(), status: 'archived' as const };
    const next = answerReviewCloze(q, 'cz1', 'good', NOW, NO_FUZZ);
    expect(next.status).toBe('archived');
  });

  it('appends a review log entry to the rated cloze', () => {
    const q = clozedQuote();
    const next = answerReviewCloze(q, 'cz1', 'good', NOW, NO_FUZZ);
    const c1 = next.clozes!.find((c) => c.id === 'cz1')!;
    expect(c1.review?.reviewLog).toHaveLength(1);
    expect(c1.review?.reviewLog![0].rating).toBe('good');
  });
});

describe('previewReviewCloze', () => {
  it('returns a preview for each of the four ratings on a cloze', () => {
    const q = clozedQuote();
    const preview = previewReviewCloze(q, 'cz1', NOW, NO_FUZZ);
    expect(Object.keys(preview).sort()).toEqual([
      'again',
      'easy',
      'good',
      'hard',
    ]);
    expect(preview.good.dueAt).toBeGreaterThan(preview.again.dueAt);
  });
});

describe('postponeReviewCloze', () => {
  it('changes only the due date on the targeted cloze, not its sibling', () => {
    const q = clozedQuote();
    const newDue = NOW + 3 * 24 * 60 * 60 * 1000;
    const next = postponeReviewCloze(q, 'cz1', NOW, newDue);
    const c1 = next.clozes!.find((c) => c.id === 'cz1')!;
    const c2 = next.clozes!.find((c) => c.id === 'cz2')!;
    expect(c1.review?.dueAt).toBe(newDue);
    expect(c2.review).toBeUndefined(); // sibling untouched
    expect(next.updatedAt).toBe(NOW);
  });
});

describe('getNextSrsWakeAt', () => {
  it('returns the next future due timestamp so sub-day cards wake the dashboard', () => {
    const dueAt = NOW + 10 * 60_000;
    const inbox: Inbox = {
      words: [
        migrateReviewState(
          word({
            review: {
              scheduler: 'fsrs-v1',
              cardState: 'learning',
              dueAt,
              intervalDays: 0,
              repetitions: 1,
              lapses: 0,
              stability: 1,
              difficulty: 5,
              learningSteps: 1,
              lastReviewedAt: NOW,
            },
          }),
        ),
      ],
      quotes: [],
    };

    expect(getNextSrsWakeAt(inbox, NOW)).toBe(dueAt);
  });
});

describe('quote cloze expansion', () => {
  it('expands a quote into one card per cloze', () => {
    const inbox: Inbox = { words: [], quotes: [clozedQuote()] };
    const due = buildSrsQueue(inbox, NOW, NO_FUZZ);
    expect(due.filter((i) => i.kind === 'quote')).toHaveLength(2);
    expect(due.map((i) => i.clozeId).sort()).toEqual(['cz1', 'cz2']);
  });

  it('contributes no cards for a quote with no clozes', () => {
    const inbox: Inbox = { words: [], quotes: [quote({ clozes: [] })] };
    expect(buildSrsQueue(inbox, NOW, NO_FUZZ)).toHaveLength(0);
  });

  it('contributes no cards for a quote with absent clozes field', () => {
    const inbox: Inbox = { words: [], quotes: [quote()] };
    expect(buildSrsQueue(inbox, NOW, NO_FUZZ)).toHaveLength(0);
  });

  it('counts each new cloze against the daily new-card cap', () => {
    const settings = { ...NO_FUZZ, newCardsPerDay: 1 };
    const inbox: Inbox = { words: [], quotes: [clozedQuote()] };
    // clozedQuote has 2 new clozes; cap=1 => only 1 card shown
    const due = buildSrsQueue(inbox, NOW, settings);
    expect(due).toHaveLength(1);
    expect(due[0].kind).toBe('quote');
    expect(due[0].clozeId).toBeDefined();
  });

  it('does not count a quote with no clozes in getSrsStats', () => {
    const inbox: Inbox = {
      words: [],
      quotes: [quote({ clozes: [] }), quote({ id: 'quote-2', clozes: [] })],
    };
    const stats = getSrsStats(inbox, NOW, NO_FUZZ, 0);
    expect(stats.newAvailableToday).toBe(0);
    expect(stats.dueLaterToday).toBe(0);
  });

  it('counts each cloze as a separate new card in getSrsStats', () => {
    const inbox: Inbox = { words: [], quotes: [clozedQuote()] };
    const dueNow = buildSrsQueue(inbox, NOW, NO_FUZZ).length;
    const stats = getSrsStats(inbox, NOW, NO_FUZZ, dueNow);
    // clozedQuote has 2 new clozes, both due now (new cards have dueAt = createdAt = YESTERDAY <= NOW)
    expect(dueNow).toBe(2);
  });

  it('counts new-reviewed-today from cloze review logs', () => {
    const startOfToday = new Date(
      new Date(NOW).getFullYear(),
      new Date(NOW).getMonth(),
      new Date(NOW).getDate(),
    ).getTime();
    // A quote where cz1 was reviewed today (state new -> learning)
    const reviewedQuote: QuoteEntry = {
      ...clozedQuote(),
      clozes: [
        {
          id: 'cz1',
          start: 1,
          end: 5,
          hint: 'none',
          review: {
            scheduler: 'fsrs-v1',
            cardState: 'learning',
            dueAt: NOW + 60_000,
            intervalDays: 0,
            repetitions: 1,
            lapses: 0,
            learningSteps: 1,
            reviewLog: [
              {
                reviewedAt: startOfToday + 60_000,
                rating: 'good',
                elapsedDays: 0,
                scheduledDays: 0,
                stateBefore: 'new',
                stateAfter: 'learning',
              },
            ],
          },
        },
        { id: 'cz2', start: 6, end: 7, hint: 'none' },
      ],
    };
    const settings = { ...NO_FUZZ, newCardsPerDay: 2 };
    const inbox: Inbox = { words: [], quotes: [reviewedQuote] };
    // cz1 was already reviewed today from 'new', so newReviewedToday=1
    // newCapacity = 2 - 1 = 1, so only cz2 (still new) can appear
    const due = buildSrsQueue(inbox, NOW, settings);
    // cz1 is learning (dueAt future), cz2 is new (dueAt <= NOW)
    expect(due.map((i) => i.clozeId)).toEqual(['cz2']);
  });

  it('stable sort tiebreak: two clozes of same quote have deterministic order', () => {
    const inbox: Inbox = { words: [], quotes: [clozedQuote()] };
    const due1 = buildSrsQueue(inbox, NOW, NO_FUZZ);
    const due2 = buildSrsQueue(inbox, NOW, NO_FUZZ);
    expect(due1.map((i) => i.clozeId)).toEqual(due2.map((i) => i.clozeId));
  });

  it('legacy quote.review is ignored: a stale review with clozes:[] yields zero queue cards', () => {
    // Regression guard: a pre-existing QuoteEntry.review (from the old recognition-only
    // model) that would have been due must NOT produce any card in buildSrsQueue.
    // Quotes are scheduled ONLY through their per-cloze cloze.review.
    const staleReview = {
      scheduler: 'fsrs-v1' as const,
      cardState: 'review' as const,
      dueAt: YESTERDAY, // overdue — would be due if the queue read quote.review
      intervalDays: 14,
      repetitions: 5,
      lapses: 0,
      stability: 14,
      difficulty: 5,
      lastReviewedAt: YESTERDAY - 14 * DAY_MS,
    };
    const quoteWithStaleReview: QuoteEntry = quote({
      id: 'legacy-quote',
      review: staleReview,
      clozes: [], // no clozes — the recognition-only model never created clozes
    });
    const inbox: Inbox = { words: [], quotes: [quoteWithStaleReview] };
    const queue = buildSrsQueue(inbox, NOW, NO_FUZZ);
    expect(queue).toHaveLength(0);

    const stats = getSrsStats(inbox, NOW, NO_FUZZ, 0);
    expect(stats.newAvailableToday).toBe(0);
    expect(stats.dueLaterToday).toBe(0);
  });

  it('word.review is still used for scheduling (word path untouched by cloze change)', () => {
    // Confirm that the word scheduling path continues to read entry.review directly,
    // as opposed to the quote path which reads cloze.review.
    const wordWithInlineReview = word({
      id: 'word-scheduled',
      review: {
        scheduler: 'fsrs-v1',
        cardState: 'review',
        dueAt: YESTERDAY, // overdue
        intervalDays: 3,
        repetitions: 2,
        lapses: 0,
        stability: 3,
        difficulty: 5,
        lastReviewedAt: YESTERDAY - 3 * DAY_MS,
      },
    });
    const inbox: Inbox = { words: [wordWithInlineReview], quotes: [] };
    const queue = buildSrsQueue(inbox, NOW, NO_FUZZ);
    expect(queue).toHaveLength(1);
    expect(queue[0].entry.id).toBe('word-scheduled');
    expect(queue[0].kind).toBe('word');
  });
});
