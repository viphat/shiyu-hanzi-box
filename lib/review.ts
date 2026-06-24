/**
 * Compatibility layer. The real scheduler lives in lib/srs.ts (FSRS). These
 * exports keep the queue item shape stable for components that App.tsx will
 * rewire in a later task. New code should import from lib/srs.ts directly.
 */
import { buildSrsQueue as buildQueue, type SrsQueueItem } from './srs';
import type { Entry, Inbox } from './types';

export type { SrsQueueItem as ReviewQueueItem } from './srs';

export function buildReviewQueue(
  inbox: Inbox,
  now = Date.now(),
): SrsQueueItem[] {
  return buildQueue(inbox, now, {
    desiredRetention: 0.9,
    maximumIntervalDays: 3650,
    newCardsPerDay: 20,
    enableFuzz: true,
  });
}

export type ReviewEntry = Entry;
