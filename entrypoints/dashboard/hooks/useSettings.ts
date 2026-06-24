import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  getSettings,
  mutateSettings,
  replaceSettings,
  watchSettings,
} from '@/lib/settings';
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

  const mutate = useCallback(
    async (fn: (settings: AppSettings) => AppSettings) => mutateSettings(fn),
    [],
  );

  const replace = useCallback(
    async (next: AppSettings) => replaceSettings(next),
    [],
  );

  return { settings, loading, mutate, replace };
}
