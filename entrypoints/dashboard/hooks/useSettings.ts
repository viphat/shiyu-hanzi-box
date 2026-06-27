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
    getSettings().then((value) => {
      if (mounted) {
        setSettings(value);
        setLoading(false);
      }
    });
    const unwatch = watchSettings((next) => {
      if (mounted) setSettings(next);
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
