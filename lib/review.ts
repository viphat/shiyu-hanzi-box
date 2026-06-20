import type { Entry, Inbox, ReviewState } from './types';

const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60];

export interface ReviewQueueItem {
  kind: Entry['kind'];
  entry: Entry;
  dueAt: number;
}

export function buildReviewQueue(inbox: Inbox, now = Date.now()): ReviewQueueItem[] {
  return [...inbox.words, ...inbox.quotes]
    .filter((entry) => entry.status !== 'archived')
    .map((entry) => ({
      kind: entry.kind,
      entry,
      dueAt: getReviewState(entry).dueAt,
    }))
    .filter((item) => item.dueAt <= endOfDay(now))
    .sort(compareQueueItems);
}

export function viewReview<T extends Entry>(entry: T, now = Date.now()): T {
  const previous = getReviewState(entry);
  const repetitions = previous.repetitions + 1;
  const intervalDays =
    REVIEW_INTERVAL_DAYS[Math.min(repetitions - 1, REVIEW_INTERVAL_DAYS.length - 1)];

  return withReview(entry, now, {
    dueAt: startOfDay(addDays(now, intervalDays)),
    intervalDays,
    repetitions,
    lapses: previous.lapses,
    lastReviewedAt: now,
  });
}

export function skipReview<T extends Entry>(entry: T, now = Date.now()): T {
  const previous = getReviewState(entry);

  return withReview(entry, now, {
    dueAt: startOfDay(addDays(now, 1)),
    intervalDays: previous.intervalDays,
    repetitions: previous.repetitions,
    lapses: previous.lapses,
    lastReviewedAt: previous.lastReviewedAt,
  });
}

export function repeatReview<T extends Entry>(
  entry: T,
  now = Date.now(),
  queueRank = now,
): T {
  const previous = getReviewState(entry);

  return withReview(entry, now, {
    dueAt: now,
    intervalDays: previous.intervalDays,
    repetitions: previous.repetitions,
    lapses: previous.lapses + 1,
    lastReviewedAt: previous.lastReviewedAt,
    queueRank,
  });
}

function getReviewState(entry: Entry): ReviewState {
  return {
    dueAt: entry.createdAt,
    intervalDays: 0,
    repetitions: 0,
    lapses: 0,
    ...entry.review,
  };
}

function withReview<T extends Entry>(entry: T, now: number, review: ReviewState): T {
  return {
    ...entry,
    status: entry.status === 'archived' ? 'archived' : 'reviewed',
    updatedAt: now,
    review,
  } as T;
}

function compareQueueItems(a: ReviewQueueItem, b: ReviewQueueItem): number {
  const aRank = a.entry.review?.queueRank;
  const bRank = b.entry.review?.queueRank;
  const aRepeated = aRank !== undefined;
  const bRepeated = bRank !== undefined;

  if (aRepeated !== bRepeated) return aRepeated ? 1 : -1;
  if (aRepeated && bRepeated && aRank !== bRank) return aRank - bRank;
  if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
  if (a.entry.createdAt !== b.entry.createdAt) return a.entry.createdAt - b.entry.createdAt;
  return a.entry.id.localeCompare(b.entry.id);
}

function startOfDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function endOfDay(time: number): number {
  return startOfDay(addDays(time, 1)) - 1;
}

function addDays(time: number, days: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}
