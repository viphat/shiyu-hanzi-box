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

export interface SrsQueueItem {
  kind: Entry['kind'];
  entry: Entry;
  dueAt: number;
  clozeId?: string;
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

function countNewReviewedToday(inbox: Inbox, now: number): number {
  const dayStart = startOfDay(now);
  const nextDay = startOfNextDay(now);
  let count = 0;
  const isNewReviewToday = (log: { stateBefore: string; reviewedAt: number }) =>
    log.stateBefore === 'new' &&
    log.reviewedAt >= dayStart &&
    log.reviewedAt < nextDay;

  for (const word of inbox.words) {
    if (word.status === 'archived') continue;
    for (const log of word.review?.reviewLog ?? []) {
      if (isNewReviewToday(log)) count += 1;
    }
  }
  for (const quote of inbox.quotes) {
    if (quote.status === 'archived') continue;
    for (const cloze of quote.clozes ?? []) {
      for (const log of cloze.review?.reviewLog ?? []) {
        if (isNewReviewToday(log)) count += 1;
      }
    }
  }
  return count;
}

function itemReview(item: SrsQueueItem): ReviewState | undefined {
  if (item.kind === 'word') {
    return item.entry.review;
  }
  // quote: find the cloze's raw review (may be undefined => treated as new)
  const quote = item.entry as QuoteEntry;
  const cloze = (quote.clozes ?? []).find((c) => c.id === item.clozeId);
  return cloze?.review;
}

export function buildSrsQueue(
  inbox: Inbox,
  now: number,
  settings: SrsSettings,
): SrsQueueItem[] {
  const newReviewedToday = countNewReviewedToday(inbox, now);
  const newCapacity = Math.max(
    0,
    settings.newCardsPerDay - newReviewedToday,
  );

  const items: SrsQueueItem[] = [];

  // Words: unchanged path — migrate, read entry.review
  for (const raw of inbox.words) {
    if (raw.status === 'archived') continue;
    const entry = migrateReviewState(raw, now);
    const review = entry.review!;
    if (review.dueAt > now) continue;
    items.push({ kind: 'word', entry, dueAt: review.dueAt });
  }

  // Quotes: one item per cloze
  for (const raw of inbox.quotes) {
    if (raw.status === 'archived') continue;
    for (const cloze of raw.clozes ?? []) {
      const review = cloze.review ?? newReviewState(raw.createdAt);
      if (review.dueAt > now) continue;
      items.push({ kind: 'quote', entry: raw, clozeId: cloze.id, dueAt: review.dueAt });
    }
  }

  items.sort((a, b) => {
    const aReview = itemReview(a);
    const bReview = itemReview(b);
    const aState = aReview?.cardState ?? 'new';
    const bState = bReview?.cardState ?? 'new';
    if (STATE_RANK[aState] !== STATE_RANK[bState]) {
      return STATE_RANK[aState] - STATE_RANK[bState];
    }
    const aRepeated = aReview?.queueRank !== undefined;
    const bRepeated = bReview?.queueRank !== undefined;
    if (aRepeated !== bRepeated) return aRepeated ? 1 : -1;
    if (aRepeated && bRepeated) {
      return aReview!.queueRank! - bReview!.queueRank!;
    }
    if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
    if (a.entry.createdAt !== b.entry.createdAt) {
      return a.entry.createdAt - b.entry.createdAt;
    }
    return a.entry.id.localeCompare(b.entry.id);
  });

  let newShown = 0;
  return items.filter((item) => {
    const cardState = itemReview(item)?.cardState ?? 'new';
    if (cardState !== 'new') return true;
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
  let dueLaterToday = 0;
  let dueNewCards = 0;
  const dayEnd = endOfDay(now);

  const newReviewedToday = countNewReviewedToday(inbox, now);
  const newCapacity = Math.max(
    0,
    settings.newCardsPerDay - newReviewedToday,
  );

  // Words: migrate and count
  for (const raw of inbox.words) {
    if (raw.status === 'archived') continue;
    const review = migrateReviewState(raw, now).review!;
    if (review.cardState === 'new' && review.dueAt <= dayEnd) {
      dueNewCards += 1;
    }
    if (review.dueAt > now && review.dueAt <= dayEnd) {
      dueLaterToday += 1;
    }
  }

  // Quotes: one card per cloze
  for (const raw of inbox.quotes) {
    if (raw.status === 'archived') continue;
    for (const cloze of raw.clozes ?? []) {
      const review = cloze.review ?? newReviewState(raw.createdAt);
      if (review.cardState === 'new' && review.dueAt <= dayEnd) {
        dueNewCards += 1;
      }
      if (review.dueAt > now && review.dueAt <= dayEnd) {
        dueLaterToday += 1;
      }
    }
  }

  const dayStart = startOfDay(now);
  const nextDay = startOfNextDay(now);
  let reviewedToday = 0;
  let remembered = 0;
  let totalReviews = 0;

  // Words: scan entry.review.reviewLog
  for (const entry of inbox.words) {
    if (entry.status === 'archived') continue;
    for (const log of entry.review?.reviewLog ?? []) {
      if (log.reviewedAt >= dayStart && log.reviewedAt < nextDay) {
        reviewedToday += 1;
      }
      totalReviews += 1;
      if (log.rating !== 'again') remembered += 1;
    }
  }

  // Quotes: scan each cloze.review.reviewLog
  for (const quote of inbox.quotes) {
    if (quote.status === 'archived') continue;
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
  for (const raw of inbox.words) {
    if (raw.status === 'archived') continue;
    const dueAt = migrateReviewState(raw, now).review!.dueAt;
    if (dueAt > now && dueAt < next) next = dueAt;
  }
  for (const raw of inbox.quotes) {
    if (raw.status === 'archived') continue;
    for (const cloze of raw.clozes ?? []) {
      const dueAt = (cloze.review ?? newReviewState(raw.createdAt)).dueAt;
      if (dueAt > now && dueAt < next) next = dueAt;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// CardId: stable, serialisable identity for any reviewable card
// ---------------------------------------------------------------------------

export type CardSource =
  | { kind: 'word'; entryId: string }
  | { kind: 'cloze'; quoteId: string; clozeId: string };

export type CardId = string;

export function cardId(s: CardSource): CardId {
  return s.kind === 'word' ? `word:${s.entryId}` : `cloze:${s.quoteId}:${s.clozeId}`;
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
