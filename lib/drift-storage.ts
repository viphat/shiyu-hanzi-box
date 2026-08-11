import { storage } from 'wxt/utils/storage';
import { EMPTY_DRIFT_STORE, normalizeDriftStore, type DriftStore } from './drift';

/**
 * Drift state lives outside the inbox on purpose. lib/sync/coordinator.ts calls
 * setInbox(materialize(merged).inbox) — a blind full replace — so any field hung
 * off an entry is destroyed on every sync pass. This item is untouched by sync.
 */
export const driftStorage = storage.defineItem<DriftStore>('local:drift', {
  fallback: EMPTY_DRIFT_STORE,
});

export async function getDriftStore(): Promise<DriftStore> {
  return normalizeDriftStore(await driftStorage.getValue());
}

/** Atomic-ish update under a simple in-process lock, mirroring mutateInbox. */
let writeChain: Promise<unknown> = Promise.resolve();

export async function mutateDriftStore(
  fn: (store: DriftStore) => DriftStore,
): Promise<DriftStore> {
  const run = writeChain
    .then(() => getDriftStore())
    .then((store) => normalizeDriftStore(fn(store)));
  const write = run.then((next) => driftStorage.setValue(next));
  // The module-level chain must never end up permanently rejected: a failure
  // here (fn throwing, or setValue rejecting on quota/context-invalidation)
  // would make every later `writeChain.then(() => getDriftStore())` skip
  // straight to rejection without ever reading or mutating again. Swallowing
  // the error only on the chained copy — never on `write` — keeps the chain
  // healthy for subsequent callers while this caller still observes the
  // rejection below.
  writeChain = write.catch(() => {});
  await write;
  return run;
}

/**
 * Full replace (used by backup restore), routed through the same writeChain
 * as mutateDriftStore rather than writing directly. Restore and a thumb tap
 * happening around the same time both go through driftStorage.setValue with
 * no ordering between them otherwise — a thumb already in flight when this
 * lands could resolve after it and resurrect the pre-restore weight it was
 * meant to replace. Chaining here gives it the same total order as every
 * other write.
 */
export async function replaceDriftStore(store: DriftStore): Promise<void> {
  const normalized = normalizeDriftStore(store);
  const write = writeChain.then(() => driftStorage.setValue(normalized));
  // Same rationale as mutateDriftStore: never let a failed write here leave
  // the module-level chain permanently rejected for later callers, while
  // still rejecting to this call's own awaiter below.
  writeChain = write.catch(() => {});
  await write;
}

export function watchDriftStore(
  listener: (store: DriftStore) => void,
): () => void {
  return driftStorage.watch((next) => listener(normalizeDriftStore(next)));
}
