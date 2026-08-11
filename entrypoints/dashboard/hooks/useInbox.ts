import { useCallback, useEffect, useState } from 'react';
import { inboxStorage } from '@/lib/storage';
import type { Inbox } from '@/lib/types';
import { EMPTY_INBOX } from '@/lib/types';
import { requestSyncMutation } from '@/entrypoints/background/sync-mutation-handler';
import { planRestoreRemovals } from '@/lib/sync/restore';

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

  // Like `mutate`, but plans OR-Set tombstones (tags, cloze blanks,
  // occurrences) off the SAME freshly-read snapshot it builds the next inbox
  // from, then fires the batched removal mutations before the inbox write.
  // Single-snapshot planning prevents the planner and the mutator from
  // disagreeing (which could resurrect a concurrently-synced member).
  // Returning null from the planner is a no-op.
  const mutateWithRemovals = useCallback(
    async (
      plan: (current: Inbox) => {
        removals?: Array<{ quoteId: string; tags: string[] }>;
        clozeRemovals?: Array<{ quoteId: string; clozeIds: string[] }>;
        occurrenceRemovals?: Array<{ normalized: string; occurrenceId: string }>;
        inbox: Inbox;
      } | null,
    ) => {
      const current = await inboxStorage.getValue();
      const result = plan(current);
      if (!result) return;
      if (result.removals?.length) {
        await requestSyncMutation('removeTags', { removals: result.removals });
      }
      const clozeRemovals = (result.clozeRemovals ?? []).filter((r) => r.clozeIds.length > 0);
      if (clozeRemovals.length > 0) {
        await requestSyncMutation('removeClozes', { removals: clozeRemovals });
      }
      if (result.occurrenceRemovals?.length) {
        await requestSyncMutation('removeOccurrence', { removals: result.occurrenceRemovals });
      }
      await requestSyncMutation('inbox', result.inbox);
    },
    [],
  );

  // Wholesale replacement (backup restore). Tags, blanks and occurrences the
  // incoming inbox does not carry are removals, not absences, so they need
  // tombstones planned off the same snapshot — otherwise the next sync pass
  // materializes them back and the restore silently fails to stick. An entry
  // the restore drops entirely still needs an entity tombstone, which this
  // does NOT write.
  const replace = useCallback(
    async (next: Inbox) => {
      await mutateWithRemovals((current) => {
        const removals = planRestoreRemovals(current, next);
        return {
          removals: removals.tags,
          clozeRemovals: removals.clozes,
          occurrenceRemovals: removals.occurrences,
          inbox: next,
        };
      });
    },
    [mutateWithRemovals],
  );

  return { inbox, loading, mutate, mutateWithRemovals, replace };
}
