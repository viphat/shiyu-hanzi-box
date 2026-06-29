import { requestSyncMutation } from './sync-mutation-handler';
import { getInbox } from '../../lib/storage';
import { wordKey, legacyOccurrenceId } from '../../lib/sync/project';
import type { UndoCaptureMessage } from '../../lib/capture';
import type { Occurrence } from '../../lib/types';

/**
 * Reverse a capture via the standard mutation pipeline. Best-effort and
 * idempotent: a missing entry/occurrence simply yields a no-op inbox write.
 * Routed through requestSyncMutation so debounced sync is always scheduled.
 */
export async function undoCapture(message: UndoCaptureMessage): Promise<void> {
  const inbox = await getInbox();

  if (message.kind === 'quote') {
    await requestSyncMutation('delete', [`quote:${message.entryId}`]);
    await requestSyncMutation('inbox', {
      ...inbox,
      quotes: inbox.quotes.filter((q) => q.id !== message.entryId),
    });
    return;
  }

  if (message.action === 'created') {
    if (message.normalized) {
      await requestSyncMutation('delete', [wordKey(message.normalized)]);
    }
    await requestSyncMutation('inbox', {
      ...inbox,
      words: inbox.words.filter((w) => w.id !== message.entryId),
    });
    return;
  }

  // occurrence-added
  const occ = message.occurrence;
  if (!occ) return;
  if (message.normalized) {
    const occurrenceId = legacyOccurrenceId(message.entryId, {
      sourceTitle: '', sourceDomain: '', ...occ,
    } as Occurrence);
    await requestSyncMutation('removeOccurrence', {
      removals: [{ normalized: message.normalized, occurrenceId }],
    });
  }
  await requestSyncMutation('inbox', {
    ...inbox,
    words: inbox.words.map((w) =>
      w.id === message.entryId
        ? {
            ...w,
            occurrences: w.occurrences.filter(
              (o) =>
                !(
                  o.sourceUrl === occ.sourceUrl &&
                  o.surrounding === occ.surrounding &&
                  o.capturedAt === occ.capturedAt
                ),
            ),
          }
        : w,
    ),
  });
}
