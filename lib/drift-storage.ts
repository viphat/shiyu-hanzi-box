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

export async function replaceDriftStore(store: DriftStore): Promise<void> {
  await driftStorage.setValue(normalizeDriftStore(store));
}

export function watchDriftStore(
  listener: (store: DriftStore) => void,
): () => void {
  return driftStorage.watch((next) => listener(normalizeDriftStore(next)));
}
