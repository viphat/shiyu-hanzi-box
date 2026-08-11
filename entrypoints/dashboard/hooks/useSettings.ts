import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  getSettings,
  watchSettings,
} from '@/lib/settings';
import { requestSyncMutation } from '@/entrypoints/background/sync-mutation-handler';
import type { AppSettings } from '@/lib/types';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    // The initial read and the watcher subscription race: a write's watcher
    // event can land before this in-flight getSettings() resolves, and
    // without this flag the initial read would then apply its
    // already-stale snapshot on top of the fresher value the watcher just
    // delivered. Once the watcher has delivered anything, it's a strictly
    // more current source of truth than the initial read, so the initial
    // read's result is discarded rather than applied.
    let watcherDelivered = false;
    getSettings().then((value) => {
      if (mounted && !watcherDelivered) {
        setSettings(value);
        setLoading(false);
      }
    });
    const unwatch = watchSettings((next) => {
      if (mounted) {
        watcherDelivered = true;
        setSettings(next);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
      unwatch();
    };
  }, []);

  const mutate = useCallback(async (fn: (settings: AppSettings) => AppSettings) => {
    const current = await getSettings();
    await requestSyncMutation('settings', fn(current));
  }, []);

  const replace = useCallback(async (next: AppSettings) => {
    await requestSyncMutation('settings', next);
  }, []);

  return { settings, loading, mutate, replace };
}
