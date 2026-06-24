import {
  fsrs,
  type Card,
  type FSRS,
  type Grade,
  Rating,
  State,
} from 'ts-fsrs';
import type {
  Entry,
  ReviewCardState,
  ReviewRating,
  ReviewState,
  SrsSettings,
} from './types';

export { DEFAULT_SRS_SETTINGS } from './settings';

export const RATING_TO_GRADE: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const CARD_STATE_TO_FSRS: Record<ReviewCardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const FSRS_TO_CARD_STATE: Record<number, ReviewCardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

export function createSrsScheduler(settings: SrsSettings): FSRS {
  return fsrs({
    request_retention: settings.desiredRetention,
    maximum_interval: settings.maximumIntervalDays,
    enable_fuzz: settings.enableFuzz,
  });
}

function newReviewState(createdAt: number): ReviewState {
  return {
    scheduler: 'fsrs-v1',
    cardState: 'new',
    dueAt: createdAt,
    intervalDays: 0,
    repetitions: 0,
    lapses: 0,
    learningSteps: 0,
  };
}

export function migrateReviewState<T extends Entry>(
  entry: T,
  _now = Date.now(),
): T {
  const review = entry.review;
  if (review?.scheduler === 'fsrs-v1') return entry;

  if (!review) {
    return { ...entry, review: newReviewState(entry.createdAt) };
  }

  const repetitions = review.repetitions ?? 0;
  const lapses = review.lapses ?? 0;

  if (repetitions > 0) {
    const interval = review.intervalDays || 1;
    const difficulty = Math.min(10, Math.max(1, 5 + lapses * 0.5));
    return {
      ...entry,
      review: {
        scheduler: 'fsrs-v1',
        cardState: 'review',
        dueAt: review.dueAt,
        intervalDays: review.intervalDays,
        repetitions,
        lapses,
        lastReviewedAt: review.lastReviewedAt,
        stability: Math.max(1, interval),
        difficulty,
        learningSteps: 0,
      },
    };
  }

  return {
    ...entry,
    review: {
      scheduler: 'fsrs-v1',
      cardState: 'new',
      dueAt: review.dueAt,
      intervalDays: 0,
      repetitions: 0,
      lapses,
      learningSteps: 0,
    },
  };
}

export function toFsrsCard(review: ReviewState): Card {
  const state = review.cardState
    ? CARD_STATE_TO_FSRS[review.cardState]
    : State.New;
  return {
    due: new Date(review.dueAt),
    stability: review.stability ?? 0,
    difficulty: review.difficulty ?? 0,
    elapsed_days: review.elapsedDays ?? 0,
    scheduled_days: review.scheduledDays ?? 0,
    learning_steps: review.learningSteps ?? 0,
    reps: review.repetitions,
    lapses: review.lapses,
    state,
    last_review:
      review.lastReviewedAt != null
        ? new Date(review.lastReviewedAt)
        : undefined,
  };
}

export function fromFsrsResult(
  card: Card,
  base: ReviewState,
  now: number,
): ReviewState {
  return {
    scheduler: 'fsrs-v1',
    cardState: FSRS_TO_CARD_STATE[card.state],
    dueAt: card.due.getTime(),
    intervalDays: card.scheduled_days,
    repetitions: card.reps,
    lapses: card.lapses,
    lastReviewedAt: now,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    queueRank: card.due.getTime() <= now ? now : undefined,
    reviewLog: base.reviewLog,
  };
}

export function toReviewLogEntry(
  review: ReviewState,
  card: Card,
  rating: ReviewRating,
  now: number,
): NonNullable<ReviewState['reviewLog']>[number] {
  const previous = review.reviewLog?.length
    ? review.reviewLog[review.reviewLog.length - 1]
    : undefined;
  const stabilityBefore = previous?.stabilityAfter ?? review.stability;
  const difficultyBefore = previous?.difficultyAfter ?? review.difficulty;
  return {
    reviewedAt: now,
    rating,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    stateBefore: review.cardState ?? 'new',
    stateAfter: FSRS_TO_CARD_STATE[card.state],
    stabilityBefore,
    stabilityAfter: card.stability,
    difficultyBefore,
    difficultyAfter: card.difficulty,
  };
}
