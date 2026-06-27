import { useCallback, useEffect, useState } from 'react';
import { inboxStorage } from '@/lib/storage';
import type { Inbox } from '@/lib/types';
import { EMPTY_INBOX } from '@/lib/types';
import { requestSyncMutation } from '@/entrypoints/background/sync-mutation-handler';

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
    await requestSyncMutation('inbox', fn(current));
  }, []);

  // Like `mutate`, but plans tag tombstones off the SAME freshly-read snapshot
  // it builds the next inbox from, then fires the batched `removeTags` mutation
  // before the inbox write. Single-snapshot planning prevents the planner and
  // the mutator from disagreeing (which could resurrect a concurrently-synced
  // tag). Returning null from the planner is a no-op.
  const mutateWithRemovals = useCallback(
    async (
      plan: (current: Inbox) => {
        removals: Array<{ quoteId: string; tags: string[] }>;
        inbox: Inbox;
      } | null,
    ) => {
      const current = await inboxStorage.getValue();
      const result = plan(current);
      if (!result) return;
      if (result.removals.length > 0) {
        await requestSyncMutation('removeTags', { removals: result.removals });
      }
      await requestSyncMutation('inbox', result.inbox);
    },
    [],
  );

  const replace = useCallback(async (next: Inbox) => {
    await requestSyncMutation('inbox', next);
  }, []);

  return { inbox, loading, mutate, mutateWithRemovals, replace };
}
