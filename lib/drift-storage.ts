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
  writeChain = run.then((next) => driftStorage.setValue(next));
  await writeChain;
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
