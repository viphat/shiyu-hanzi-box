import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, settingsStorage } from '@/lib/settings';
import type { AppSettings } from '@/lib/types';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    settingsStorage.getValue().then((value) => {
      if (mounted) {
        setSettings(value);
        setLoading(false);
      }
    });
    const unwatch = settingsStorage.watch((next) => {
      if (mounted) setSettings(next ?? DEFAULT_SETTINGS);
    });
    return () => {
      mounted = false;
      unwatch();
    };
  }, []);

  const mutate = useCallback(async (fn: (settings: AppSettings) => AppSettings) => {
    const current = await settingsStorage.getValue();
    await settingsStorage.setValue(fn(current));
  }, []);

  const replace = useCallback(async (next: AppSettings) => {
    await settingsStorage.setValue(next);
  }, []);

  return { settings, loading, mutate, replace };
}
