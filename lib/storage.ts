import { storage } from 'wxt/utils/storage';
import type { Inbox } from './types';
import { EMPTY_INBOX } from './types';

export const inboxStorage = storage.defineItem<Inbox>('local:inbox', {
  fallback: EMPTY_INBOX,
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
