import { useCallback, useEffect, useState } from 'react';
import { inboxStorage } from '@/lib/storage';
import type { Inbox } from '@/lib/types';
import { EMPTY_INBOX } from '@/lib/types';

export function useInbox() {
  const [inbox, setInbox] = useState<Inbox>(EMPTY_INBOX);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    inboxStorage.getValue().then((value) => {
      if (mounted) {
        setInbox(value);
        setLoading(false);
      }
    });
    const unwatch = inboxStorage.watch((next) => {
      if (mounted) setInbox(next ?? EMPTY_INBOX);
    });
    return () => {
      mounted = false;
      unwatch();
    };
  }, []);

  const mutate = useCallback(async (fn: (inbox: Inbox) => Inbox) => {
    const current = await inboxStorage.getValue();
    await inboxStorage.setValue(fn(current));
  }, []);

  return { inbox, loading, mutate };
}
