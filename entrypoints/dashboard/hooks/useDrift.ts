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

  useEffect(() => {
    mountedRef.current = true;
    // The initial read and the watcher subscription race: a write's watcher
    // event can land before this in-flight getDriftStore() resolves, and
    // without this flag the initial read would then apply its
    // already-stale snapshot on top of the fresher value the watcher just
    // delivered. Once the watcher has delivered anything, it's a strictly
    // more current source of truth than the initial read, so the initial
    // read's result is discarded rather than applied.
    let watcherDelivered = false;
    void getDriftStore().then((value) => {
      if (!mountedRef.current || watcherDelivered) return;
      setDriftStore(value);
      setLoading(false);
    });
    const unwatch = watchDriftStore((next) => {
      if (!mountedRef.current) return;
      watcherDelivered = true;
      setDriftStore(next);
      setLoading(false);
    });
    return () => {
      mountedRef.current = false;
      unwatch();
    };
  }, []);

  const mutateDrift = useCallback(async (fn: (store: DriftStore) => DriftStore) => {
    // Don't echo `next` into state here: watchDriftStore above is the sole
    // writer of `driftStore`, mirroring useSettings. storage.onChanged fires
    // for the writer's own writes too, so the watcher already delivers this
    // update -- a second local setDriftStore would just be a redundant writer
    // racing the watcher for no benefit. Still await the write so callers can
    // observe completion/rejection.
    await mutateDriftStore(fn);
  }, []);

  return { driftStore, loading, mutateDrift };
}
