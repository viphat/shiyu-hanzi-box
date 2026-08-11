import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_DRIFT_STORE, type DriftStore } from '@/lib/drift';
import { getDriftStore, mutateDriftStore, watchDriftStore } from '@/lib/drift-storage';

/**
 * Drift state is outside the sync domain, so this hook writes storage directly
 * rather than going through requestSyncMutation like useSettings does.
 */
export function useDrift() {
  const [driftStore, setDriftStore] = useState<DriftStore>(EMPTY_DRIFT_STORE);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  // Bumped on every applied update, from either path. watchDriftStore is
  // driven by the storage layer's own change timeline, so it always reflects
  // the true write order -- including for writes this hook itself made via
  // mutateDrift below. That lets mutateDrift tell whether a watcher event
  // (its own write's, or someone else's) already landed a newer store while
  // its write was in flight, so its own echo of `next` never clobbers
  // something newer with something stale.
  const generationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    void getDriftStore().then((value) => {
      if (!mountedRef.current) return;
      generationRef.current += 1;
      setDriftStore(value);
      setLoading(false);
    });
    const unwatch = watchDriftStore((next) => {
      if (!mountedRef.current) return;
      generationRef.current += 1;
      setDriftStore(next);
    });
    return () => {
      mountedRef.current = false;
      unwatch();
    };
  }, []);

  const mutateDrift = useCallback(async (fn: (store: DriftStore) => DriftStore) => {
    const generationBeforeWrite = generationRef.current;
    const next = await mutateDriftStore(fn);
    // A watcher event landing while this write was in flight is at least as
    // new as `next` -- skip our own echo so it can't stomp that newer state.
    if (!mountedRef.current || generationRef.current !== generationBeforeWrite) return;
    generationRef.current += 1;
    setDriftStore(next);
  }, []);

  return { driftStore, loading, mutateDrift };
}
