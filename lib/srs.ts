import {
  fsrs,
  type Card,
  type FSRS,
  type Grade,
  Rating,
  State,
} from 'ts-fsrs';
import type {
  Cloze,
  Entry,
  Inbox,
  QuoteEntry,
  ReviewCardState,
  ReviewLogEntry,
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

const DAY_MS = 24 * 60 * 60 * 1000;

export function createSrsScheduler(settings: SrsSettings): FSRS {
  return fsrs({
    request_retention: settings.desiredRetention,
    maximum_interval: settings.maximumIntervalDays,
    enable_fuzz: settings.enableFuzz,
  });
}

export function newReviewState(createdAt: number): ReviewState {
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

export interface SrsPreviewItem {
  cardState: ReviewCardState;
  dueAt: number;
  intervalDays: number;
}

export type SrsPreview = Record<ReviewRating, SrsPreviewItem>;

const RATING_KEYS: ReviewRating[] = ['again', 'hard', 'good', 'easy'];

export function appendLog(
  review: ReviewState,
  entry: ReviewLogEntry,
): ReviewLogEntry[] {
  const next = review.reviewLog ? [...review.reviewLog] : [];
  next.push(entry);
  return next;
}

export function answerReview<T extends Entry>(
  entry: T,
  rating: ReviewRating,
  now: number,
  settings: SrsSettings,
): T {
  const migrated = migrateReviewState(entry, now);
  const review = migrated.review!;
  const scheduler = createSrsScheduler(settings);
  const card = toFsrsCard(review);
  const result = scheduler.next(card, now, RATING_TO_GRADE[rating]);
  const log = toReviewLogEntry(review, result.card, rating, now);
  const nextReview = fromFsrsResult(result.card, review, now);
  return {
    ...migrated,
    status: migrated.status === 'archived' ? 'archived' : 'reviewed',
    updatedAt: now,
    review: {
      ...nextReview,
      reviewLog: appendLog(review, log),
    },
  };
}

export function previewReview(
  entry: Entry,
  now: number,
  settings: SrsSettings,
): SrsPreview {
  const migrated = migrateReviewState(entry, now);
  const scheduler = createSrsScheduler(settings);
  const preview = scheduler.repeat(toFsrsCard(migrated.review!), now);
  const result: Partial<SrsPreview> = {};
  for (const key of RATING_KEYS) {
    const item = preview[RATING_TO_GRADE[key]];
    result[key] = {
      cardState: FSRS_TO_CARD_STATE[item.card.state],
      dueAt: item.card.due.getTime(),
      intervalDays: item.card.scheduled_days,
    };
  }
  return result as SrsPreview;
}

export function postponeReview<T extends Entry>(
  entry: T,
  now: number,
  dueAt: number,
): T {
  const migrated = migrateReviewState(entry, now);
  const review = migrated.review!;
  return {
    ...migrated,
    updatedAt: now,
    review: {
      ...review,
      dueAt,
      scheduledDays: Math.max(0, Math.ceil((dueAt - now) / DAY_MS)),
      queueRank: undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Card identity (derived, never persisted)
// ---------------------------------------------------------------------------

export type CardSource =
  | { kind: 'word'; entryId: string }
  | { kind: 'cloze'; quoteId: string; clozeId: string };

export type CardId = string;

export function cardId(s: CardSource): CardId {
  return s.kind === 'word'
    ? `word:${s.entryId}`
    : `cloze:${s.quoteId}:${s.clozeId}`;
}

// ---------------------------------------------------------------------------
// Cloze-aware FSRS wrappers
// ---------------------------------------------------------------------------

export function answerReviewCloze(
  quote: QuoteEntry,
  clozeId: string,
  rating: ReviewRating,
  now: number,
  settings: SrsSettings,
): QuoteEntry {
  const clozes = (quote.clozes ?? []).map((c: Cloze) => {
    if (c.id !== clozeId) return c;
    const review = c.review ?? newReviewState(now);
    const scheduler = createSrsScheduler(settings);
    const result = scheduler.next(toFsrsCard(review), now, RATING_TO_GRADE[rating]);
    const log = toReviewLogEntry(review, result.card, rating, now);
    return {
      ...c,
      review: {
        ...fromFsrsResult(result.card, review, now),
        reviewLog: appendLog(review, log),
      },
    };
  });
  return {
    ...quote,
    status: quote.status === 'archived' ? 'archived' : 'reviewed',
    updatedAt: now,
    clozes,
  };
}

// Parity with previewReview (word path); both are currently unwired in the UI and intended for future preview-interval display.
export function previewReviewCloze(
  quote: QuoteEntry,
  clozeId: string,
  now: number,
  settings: SrsSettings,
): SrsPreview {
  const cloze = (quote.clozes ?? []).find((c: Cloze) => c.id === clozeId);
  const review = cloze?.review ?? newReviewState(now);
  const scheduler = createSrsScheduler(settings);
  const preview = scheduler.repeat(toFsrsCard(review), now);
  const result: Partial<SrsPreview> = {};
  for (const key of RATING_KEYS) {
    const item = preview[RATING_TO_GRADE[key]];
    result[key] = {
      cardState: FSRS_TO_CARD_STATE[item.card.state],
      dueAt: item.card.due.getTime(),
      intervalDays: item.card.scheduled_days,
    };
  }
  return result as SrsPreview;
}

export function postponeReviewCloze(
  quote: QuoteEntry,
  clozeId: string,
  now: number,
  dueAt: number,
): QuoteEntry {
  const clozes = (quote.clozes ?? []).map((c: Cloze) => {
    if (c.id !== clozeId) return c;
    const review = c.review ?? newReviewState(now);
    return {
      ...c,
      review: {
        ...review,
        dueAt,
        scheduledDays: Math.max(0, Math.ceil((dueAt - now) / DAY_MS)),
        queueRank: undefined,
      },
    };
  });
  return {
    ...quote,
    updatedAt: now,
    clozes,
  };
}

export interface SrsQueueItem {
  kind: Entry['kind'];
  entry: Entry;
  dueAt: number;
  clozeId?: string;
}

/** Returns the effective ReviewState for a queue item.
 * Words -> entry.review (already migrated).
 * Quote clozes -> the cloze's review, falling back to a new state. */
function itemReview(item: SrsQueueItem): ReviewState {
  if (item.kind === 'word' || !item.clozeId) {
    return item.entry.review!;
  }
  const quote = item.entry as QuoteEntry;
  const cloze = (quote.clozes ?? []).find((c: Cloze) => c.id === item.clozeId);
  return cloze?.review ?? newReviewState(item.entry.createdAt);
}

export interface SrsStats {
  dueNow: number;
  dueLaterToday: number;
  newAvailableToday: number;
  reviewedToday: number;
  retention: number | null;
}

const STATE_RANK: Record<ReviewCardState, number> = {
  learning: 0,
  relearning: 0,
  review: 1,
  new: 2,
};

function startOfDay(time: number): number {
  const date = new Date(time);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

export function startOfNextDay(time: number): number {
  const date = new Date(time);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  ).getTime();
}

function endOfDay(time: number): number {
  return startOfNextDay(time) - 1;
}

function countNewReviewedToday(entries: Entry[], now: number): number {
  const dayStart = startOfDay(now);
  const nextDay = startOfNextDay(now);
  let count = 0;
  for (const entry of entries) {
    if (entry.kind === 'word') {
      // Words: scan entry.review.reviewLog
      for (const log of entry.review?.reviewLog ?? []) {
        if (
          log.stateBefore === 'new' &&
          log.reviewedAt >= dayStart &&
          log.reviewedAt < nextDay
        ) {
          count += 1;
        }
      }
    } else {
      // Quotes: scan each cloze's review.reviewLog
      const quote = entry as QuoteEntry;
      for (const cloze of quote.clozes ?? []) {
        for (const log of cloze.review?.reviewLog ?? []) {
          if (
            log.stateBefore === 'new' &&
            log.reviewedAt >= dayStart &&
            log.reviewedAt < nextDay
          ) {
            count += 1;
          }
        }
      }
    }
  }
  return count;
}

export function buildSrsQueue(
  inbox: Inbox,
  now: number,
  settings: SrsSettings,
): SrsQueueItem[] {
  const entries: Entry[] = [...inbox.words, ...inbox.quotes].filter(
    (entry) => entry.status !== 'archived',
  );

  const newReviewedToday = countNewReviewedToday(entries, now);
  const newCapacity = Math.max(
    0,
    settings.newCardsPerDay - newReviewedToday,
  );

  const items: SrsQueueItem[] = [];
  for (const raw of entries) {
    const entry = migrateReviewState(raw, now);
    if (entry.kind === 'word') {
      const review = entry.review!;
      if (review.dueAt > now) continue;
      items.push({ kind: 'word', entry, dueAt: review.dueAt });
    } else {
      // Quote: expand into one item per cloze; no clozes => skip entirely.
      // NOTE: QuoteEntry.review (the top-level field) is intentionally ignored here.
      // In the legacy recognition-only model, quotes were scheduled via entry.review.
      // Since Task 5, quotes schedule ONLY through their per-cloze cloze.review.
      // Any pre-existing quote.review is a one-time scheduling reset — it will never
      // produce a queue card and does not need to be cleared from storage.
      const quote = entry as QuoteEntry;
      for (const cloze of quote.clozes ?? []) {
        const effectiveReview = cloze.review ?? newReviewState(entry.createdAt);
        if (effectiveReview.dueAt > now) continue;
        items.push({
          kind: 'quote',
          entry,
          dueAt: effectiveReview.dueAt,
          clozeId: cloze.id,
        });
      }
    }
  }

  items.sort((a, b) => {
    const aReview = itemReview(a);
    const bReview = itemReview(b);
    const aState = aReview.cardState ?? 'new';
    const bState = bReview.cardState ?? 'new';
    if (STATE_RANK[aState] !== STATE_RANK[bState]) {
      return STATE_RANK[aState] - STATE_RANK[bState];
    }
    const aRepeated = aReview.queueRank !== undefined;
    const bRepeated = bReview.queueRank !== undefined;
    if (aRepeated !== bRepeated) return aRepeated ? 1 : -1;
    if (aRepeated && bRepeated) {
      return aReview.queueRank! - bReview.queueRank!;
    }
    if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
    if (a.entry.createdAt !== b.entry.createdAt) {
      return a.entry.createdAt - b.entry.createdAt;
    }
    const idCmp = a.entry.id.localeCompare(b.entry.id);
    if (idCmp !== 0) return idCmp;
    // Stable tiebreak for two clozes of the same quote
    return (a.clozeId ?? '').localeCompare(b.clozeId ?? '');
  });

  let newShown = 0;
  return items.filter((item) => {
    const review = itemReview(item);
    if (review.cardState !== 'new') return true;
    if (newShown >= newCapacity) return false;
    newShown += 1;
    return true;
  });
}

export function getSrsStats(
  inbox: Inbox,
  now: number,
  settings: SrsSettings,
  dueNowCount: number,
): SrsStats {
  const entries: Entry[] = [...inbox.words, ...inbox.quotes].filter(
    (entry) => entry.status !== 'archived',
  );

  let dueLaterToday = 0;
  let dueNewCards = 0;
  const dayEnd = endOfDay(now);

  const newReviewedToday = countNewReviewedToday(entries, now);
  const newCapacity = Math.max(
    0,
    settings.newCardsPerDay - newReviewedToday,
  );

  for (const raw of entries) {
    const entry = migrateReviewState(raw, now);
    if (entry.kind === 'word') {
      const review = entry.review!;
      if (review.cardState === 'new' && review.dueAt <= dayEnd) {
        dueNewCards += 1;
      }
      if (review.dueAt > now && review.dueAt <= dayEnd) {
        dueLaterToday += 1;
      }
    } else {
      // Quote: expand per cloze; quotes without clozes contribute nothing
      const quote = entry as QuoteEntry;
      for (const cloze of quote.clozes ?? []) {
        const effectiveReview = cloze.review ?? newReviewState(entry.createdAt);
        if (effectiveReview.cardState === 'new' && effectiveReview.dueAt <= dayEnd) {
          dueNewCards += 1;
        }
        if (effectiveReview.dueAt > now && effectiveReview.dueAt <= dayEnd) {
          dueLaterToday += 1;
        }
      }
    }
  }

  const dayStart = startOfDay(now);
  const nextDay = startOfNextDay(now);
  let reviewedToday = 0;
  let remembered = 0;
  let totalReviews = 0;
  for (const entry of entries) {
    if (entry.kind === 'word') {
      for (const log of entry.review?.reviewLog ?? []) {
        if (log.reviewedAt >= dayStart && log.reviewedAt < nextDay) {
          reviewedToday += 1;
        }
        totalReviews += 1;
        if (log.rating !== 'again') remembered += 1;
      }
    } else {
      // Quote: scan each cloze's review log
      const quote = entry as QuoteEntry;
      for (const cloze of quote.clozes ?? []) {
        for (const log of cloze.review?.reviewLog ?? []) {
          if (log.reviewedAt >= dayStart && log.reviewedAt < nextDay) {
            reviewedToday += 1;
          }
          totalReviews += 1;
          if (log.rating !== 'again') remembered += 1;
        }
      }
    }
  }

  return {
    dueNow: dueNowCount,
    dueLaterToday,
    newAvailableToday: Math.min(newCapacity, dueNewCards),
    reviewedToday,
    retention: totalReviews >= 10 ? remembered / totalReviews : null,
  };
}

export function getNextSrsWakeAt(inbox: Inbox, now: number): number {
  let next = startOfNextDay(now);
  for (const raw of [...inbox.words, ...inbox.quotes]) {
    if (raw.status === 'archived') continue;
    const entry = migrateReviewState(raw, now);
    if (entry.kind === 'word') {
      const dueAt = entry.review!.dueAt;
      if (dueAt > now && dueAt < next) next = dueAt;
    } else {
      // Quote: check each cloze's due date
      const quote = entry as QuoteEntry;
      for (const cloze of quote.clozes ?? []) {
        const effectiveReview = cloze.review ?? newReviewState(entry.createdAt);
        const dueAt = effectiveReview.dueAt;
        if (dueAt > now && dueAt < next) next = dueAt;
      }
    }
  }
  return next;
}
