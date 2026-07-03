import { useCallback, useEffect, useState } from 'react';
import { getOnboardingSeen, markOnboardingSeen } from '@/lib/onboarding';

export function useOnboarding() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    void getOnboardingSeen()
      .then((seen) => {
        if (mounted && !seen) setOpen(true);
      })
      .catch(() => {
        if (mounted) setOpen(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    void markOnboardingSeen();
  }, []);

  const openManually = useCallback(() => {
    setOpen(true);
  }, []);

  return { open, loading, close, openManually };
}
