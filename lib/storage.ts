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
  const run = writeChain.then(() => getInbox()).then((inbox) => fn(inbox));
  writeChain = run.then(setInbox);
  return run;
}
