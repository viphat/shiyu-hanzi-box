import { storage } from 'wxt/utils/storage';
import type { Inbox, QuoteEntry } from './types';
import { EMPTY_INBOX } from './types';
import { migrateQuoteCategoryToTags } from './tags';

/**
 * v1 → v2: collapse the freeform `category` field into `tags`. Pure and
 * idempotent so it is safe whether or not a quote still carries `category`.
 * Exported for unit testing; wired as the WXT `migrations[2]` step below.
 */
export function migrateInboxV1ToV2(old: unknown): Inbox {
  const value = (old ?? {}) as { words?: unknown[]; quotes?: unknown[] };
  return {
    words: (value.words ?? []) as Inbox['words'],
    quotes: ((value.quotes ?? []) as Array<{ category?: string; tags?: string[] }>).map(
      (quote) => migrateQuoteCategoryToTags(quote) as unknown as QuoteEntry,
    ),
  };
}

export const inboxStorage = storage.defineItem<Inbox>('local:inbox', {
  fallback: EMPTY_INBOX,
  version: 2,
  migrations: {
    2: (old: unknown): Inbox => migrateInboxV1ToV2(old),
  },
});

export async function getInbox(): Promise<Inbox> {
  return inboxStorage.getValue();
}

export async function setInbox(next: Inbox): Promise<void> {
  await inboxStorage.setValue(next);
}

/** Atomic-ish update: read-modify-write under a simple in-process lock. */
let writeChain: Promise<unknown> = Promise.resolve();
export async function mutateInbox(
  fn: (inbox: Inbox) => Inbox | Promise<Inbox>,
): Promise<Inbox> {
  const run = writeChain
    .then(() => getInbox())
    .then(async (inbox) => {
      const next = await fn(inbox);
      // Persist inside `run` so callers only resolve once the write landed —
      // awaiting `mutateInbox` then reading storage must not see the old value.
      await setInbox(next);
      return next;
    });
  // The chain is shared by every later mutation, so it must never stay
  // rejected: a thrown mutator or a failed write (quota, invalidated
  // extension context) would otherwise short-circuit all subsequent writes
  // for the life of the page. Swallow it here; `run` still carries the error
  // back to the caller that caused it.
  writeChain = run.catch(() => {});
  return run;
}
