// Review history is a union-only OR-Set: events are added by id and nothing
// ever removed them, so a restore could roll back an entry's text but not its
// reviews — the log and the scheduler state it drives came straight back on the
// next pass. A restore now tombstones the review events the backup does not
// carry, for words, quotes and each cloze blank.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { runSyncPass } from '../../lib/sync/coordinator';
import { deriveKey, defaultKdfParams } from '../../lib/sync/crypto';
import { encryptReplica } from '../../lib/sync/vault';
import { projectInbox } from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import { applyRestore } from '../../lib/sync/mutations';
import { getSyncConfig, setSyncConfig } from '../../lib/sync/local';
import { getInbox, setInbox } from '../../lib/storage';
import type { Cloze, Inbox, QuoteEntry, ReviewState, WordEntry } from '../../lib/types';
import type { SyncReplica } from '../../lib/sync/types';

const REPLICA_ID = '01J0AZ5K2YJ3M4N5P6Q7R8S9TW';

async function deps() {
  const key = await deriveKey('pw', defaultKdfParams());
  return { fs: new MemoryFs(), key, vaultId: 'V1', replicaId: REPLICA_ID, now: () => 1000 };
}

/** A review state with `n` logged reviews, the last one at 700 + n - 1. */
function reviewed(n: number): ReviewState {
  return {
    scheduler: 'fsrs-v1',
    dueAt: 5000 + n,
    intervalDays: n,
    repetitions: n,
    lapses: 0,
    lastReviewedAt: 700 + n - 1,
    reviewLog: Array.from({ length: n }, (_, i) => ({
      reviewedAt: 700 + i,
      rating: 'good' as const,
      elapsedDays: 1,
      scheduledDays: 2,
      stateBefore: 'review' as const,
      stateAfter: 'review' as const,
    })),
  };
}

function quote(over: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '天行健',
    note: '',
    status: 'inbox',
    tags: [],
    createdAt: 10,
    updatedAt: 20,
    sourceTitle: '',
    sourceUrl: '',
    sourceDomain: '',
    surrounding: '',
    ...over,
  };
}

function word(review: ReviewState): WordEntry {
  return {
    id: 'w1',
    kind: 'word',
    text: '你好',
    normalized: '你好',
    note: '',
    status: 'inbox',
    createdAt: 10,
    updatedAt: 20,
    occurrences: [],
    review,
  };
}

const blank = (review?: ReviewState): Cloze => ({ id: 'c1', start: 0, end: 1, ...(review ? { review } : {}) });

async function seedRemote(fs: MemoryFs, key: CryptoKey, inbox: Inbox): Promise<void> {
  const replica: SyncReplica = {
    app: 'shiyu-hanzi-box',
    formatVersion: 1,
    vaultId: 'V1',
    replicaId: 'R-REMOTE',
    writtenAt: { wallTime: 500, counter: 0, replicaId: 'R-REMOTE' },
    state: projectInbox(inbox, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, {
      replicaId: 'R-REMOTE',
      wallTime: 500,
    }),
  };
  fs.seed('01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu', await encryptReplica(key, replica));
}

describe('backup restore, review history', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    const cfg = await getSyncConfig();
    await setSyncConfig({ ...cfg, replicaId: REPLICA_ID, vaultId: 'V1' });
  });

  it('rolls a quote review log back to what the backup holds', async () => {
    const d = await deps();
    await setInbox({ words: [], quotes: [quote({ review: reviewed(3) })] });
    await runSyncPass(d);

    await applyRestore({ words: [], quotes: [quote({ review: reviewed(1) })] });
    await runSyncPass(d);

    expect((await getInbox()).quotes[0].review?.reviewLog).toHaveLength(1);
  });

  it('rolls the scheduler state back with it', async () => {
    const d = await deps();
    await setInbox({ words: [], quotes: [quote({ review: reviewed(3) })] });
    await runSyncPass(d);

    await applyRestore({ words: [], quotes: [quote({ review: reviewed(1) })] });
    await runSyncPass(d);

    const review = (await getInbox()).quotes[0].review;
    expect(review?.repetitions).toBe(1);
    expect(review?.dueAt).toBe(5001);
  });

  it('rolls a word review log back too', async () => {
    const d = await deps();
    await setInbox({ words: [word(reviewed(3))], quotes: [] });
    await runSyncPass(d);

    await applyRestore({ words: [word(reviewed(1))], quotes: [] });
    await runSyncPass(d);

    expect((await getInbox()).words[0].review?.reviewLog).toHaveLength(1);
  });

  it('rolls a cloze review log back too', async () => {
    const d = await deps();
    await setInbox({ words: [], quotes: [quote({ clozes: [blank(reviewed(3))] })] });
    await runSyncPass(d);

    await applyRestore({ words: [], quotes: [quote({ clozes: [blank(reviewed(1))] })] });
    await runSyncPass(d);

    expect((await getInbox()).quotes[0].clozes?.[0].review?.reviewLog).toHaveLength(1);
  });

  it('is not undone by a peer replica that still holds the newer reviews', async () => {
    const d = await deps();
    const before = { words: [], quotes: [quote({ review: reviewed(3) })] };
    await setInbox(before);
    await runSyncPass(d);
    await seedRemote(d.fs, d.key, before);

    await applyRestore({ words: [], quotes: [quote({ review: reviewed(1) })] });
    await runSyncPass(d);

    expect((await getInbox()).quotes[0].review?.reviewLog).toHaveLength(1);
  });

  it('keeps the reviews the backup does carry', async () => {
    const d = await deps();
    await setInbox({ words: [], quotes: [quote({ review: reviewed(3) })] });
    await runSyncPass(d);

    await applyRestore({ words: [], quotes: [quote({ review: reviewed(3) })] });
    await runSyncPass(d);

    expect((await getInbox()).quotes[0].review?.reviewLog).toHaveLength(3);
  });

  it('does not suppress a review logged after the restore', async () => {
    const d = await deps();
    await setInbox({ words: [], quotes: [quote({ review: reviewed(3) })] });
    await runSyncPass(d);
    await applyRestore({ words: [], quotes: [quote({ review: reviewed(1) })] });
    await runSyncPass(d);

    // Answering the card again writes an event stamped after the tombstone.
    const rolledBack = (await getInbox()).quotes[0];
    const log = rolledBack.review!.reviewLog!;
    const laterReview: ReviewState = {
      ...rolledBack.review!,
      lastReviewedAt: Date.now(),
      reviewLog: [...log, { ...log[0], reviewedAt: Date.now() }],
    };
    await setInbox({ words: [], quotes: [{ ...rolledBack, review: laterReview }] });
    await runSyncPass(d);

    expect((await getInbox()).quotes[0].review?.reviewLog).toHaveLength(2);
  });
});
