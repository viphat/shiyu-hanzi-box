import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { runSyncPass } from '../../lib/sync/coordinator';
import { deriveKey, defaultKdfParams } from '../../lib/sync/crypto';
import { encryptReplica } from '../../lib/sync/vault';
import { projectInbox } from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import {
  applyClozeRemoval,
  applyLocalMutation,
  reconcileOnStartup,
  syncMetadataStorage,
} from '../../lib/sync/mutations';
import { getSyncConfig, setSyncConfig } from '../../lib/sync/local';
import { getInbox, setInbox } from '../../lib/storage';
import { EMPTY_SYNC_STATE } from '../../lib/sync/types';
import type { Cloze, Inbox, QuoteEntry } from '../../lib/types';
import type { SyncReplica } from '../../lib/sync/types';

const REPLICA_ID = '01J0AZ5K2YJ3M4N5P6Q7R8S9TW';

async function deps(replicaId = REPLICA_ID, now = 1000) {
  const key = await deriveKey('pw', defaultKdfParams());
  return { fs: new MemoryFs(), key, vaultId: 'V1', replicaId, now: () => now };
}

function quoteWithClozes(clozes: Cloze[]): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '天行健君子以自强不息',
    note: '',
    status: 'inbox',
    tags: [],
    createdAt: 100,
    updatedAt: 200,
    sourceTitle: '周易',
    sourceUrl: 'https://example.com/yi',
    sourceDomain: 'example.com',
    surrounding: '',
    clozes,
  };
}

async function seedRemote(
  fs: MemoryFs,
  key: CryptoKey,
  inbox: Inbox,
  opts: { replicaId?: string; wallTime?: number } = {},
): Promise<void> {
  const replicaId = opts.replicaId ?? 'R-REMOTE';
  const state = projectInbox(inbox, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, {
    replicaId,
    wallTime: opts.wallTime ?? 500,
  });
  const replica: SyncReplica = {
    app: 'shiyu-hanzi-box',
    formatVersion: 1,
    vaultId: 'V1',
    replicaId,
    writtenAt: { wallTime: opts.wallTime ?? 500, counter: 0, replicaId },
    state,
  };
  fs.seed('01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu', await encryptReplica(key, replica));
}

describe('cloze survival across a sync pass', () => {
  beforeEach(() => fakeBrowser.reset());

  it('keeps cloze blanks and their FSRS state after a solo sync pass', async () => {
    const d = await deps();
    await setInbox({
      words: [],
      quotes: [
        quoteWithClozes([
          {
            id: 'c1',
            start: 0,
            end: 2,
            hint: 'pinyin',
            wordId: 'w-tian',
            review: {
              scheduler: 'fsrs-v1',
              dueAt: 5000,
              intervalDays: 3,
              repetitions: 2,
              lapses: 1,
              lastReviewedAt: 900,
              cardState: 'review',
              stability: 4.2,
              difficulty: 6.1,
              reviewLog: [
                {
                  reviewedAt: 900,
                  rating: 'good',
                  elapsedDays: 1,
                  scheduledDays: 3,
                  stateBefore: 'learning',
                  stateAfter: 'review',
                },
              ],
            },
          },
          { id: 'c2', start: 5, end: 7 },
        ]),
      ],
    });

    const result = await runSyncPass(d);
    expect(result.status).toBe('synced');

    const quote = (await getInbox()).quotes[0];
    expect(quote.clozes?.map((c) => c.id)).toEqual(['c1', 'c2']);
    const c1 = quote.clozes![0];
    expect(c1.start).toBe(0);
    expect(c1.end).toBe(2);
    expect(c1.hint).toBe('pinyin');
    expect(c1.wordId).toBe('w-tian');
    expect(c1.review?.dueAt).toBe(5000);
    expect(c1.review?.repetitions).toBe(2);
    expect(c1.review?.lapses).toBe(1);
    expect(c1.review?.stability).toBe(4.2);
    expect(c1.review?.reviewLog).toHaveLength(1);
    expect(quote.clozes![1].review).toBeUndefined();
  });

  it('unions a blank added on a peer with a blank added locally', async () => {
    const d = await deps();
    await setInbox({ words: [], quotes: [quoteWithClozes([{ id: 'local', start: 0, end: 2 }])] });
    await seedRemote(d.fs, d.key, {
      words: [],
      quotes: [quoteWithClozes([{ id: 'remote', start: 5, end: 7, hint: 'length' }])],
    });

    await runSyncPass(d);

    const quote = (await getInbox()).quotes[0];
    expect(quote.clozes?.map((c) => c.id)).toEqual(['local', 'remote']);
    expect(quote.clozes?.find((c) => c.id === 'remote')?.hint).toBe('length');
  });

  it('carries a cloze review answered on a peer into local state', async () => {
    const d = await deps();
    const blank: Cloze = { id: 'c1', start: 0, end: 2 };
    await setInbox({ words: [], quotes: [quoteWithClozes([blank])] });
    await seedRemote(d.fs, d.key, {
      words: [],
      quotes: [
        {
          ...quoteWithClozes([
            {
              ...blank,
              review: {
                scheduler: 'fsrs-v1',
                dueAt: 90_000,
                intervalDays: 7,
                repetitions: 1,
                lapses: 0,
                lastReviewedAt: 80_000,
                reviewLog: [
                  {
                    reviewedAt: 80_000,
                    rating: 'easy',
                    elapsedDays: 0,
                    scheduledDays: 7,
                    stateBefore: 'new',
                    stateAfter: 'review',
                  },
                ],
              },
            },
          ]),
          updatedAt: 80_000,
        },
      ],
    }, { wallTime: 80_000 });

    await runSyncPass(d);

    const c1 = (await getInbox()).quotes[0].clozes![0];
    expect(c1.review?.dueAt).toBe(90_000);
    expect(c1.review?.reviewLog).toHaveLength(1);
  });
});

describe('cloze removal', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    const cfg = await getSyncConfig();
    await setSyncConfig({ ...cfg, replicaId: REPLICA_ID, vaultId: 'V1' });
  });

  it('keeps a removed blank removed when a peer replica still holds it', async () => {
    const d = await deps();
    const keep: Cloze = { id: 'keep', start: 0, end: 2 };
    const drop: Cloze = { id: 'drop', start: 5, end: 7 };
    await setInbox({ words: [], quotes: [quoteWithClozes([keep, drop])] });
    await runSyncPass(d);

    // Peer replica written before the removal — it still holds both blanks.
    await seedRemote(d.fs, d.key, { words: [], quotes: [quoteWithClozes([keep, drop])] });

    // Dashboard removal flow: tombstone first, then the inbox write.
    await applyClozeRemoval([{ quoteId: 'q1', clozeIds: ['drop'] }]);
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [{ ...quoteWithClozes([keep]), updatedAt: 300 }] });
    });

    await runSyncPass(d);

    expect((await getInbox()).quotes[0].clozes?.map((c) => c.id)).toEqual(['keep']);
  });

  it('keeps a per-node clozeTombstone across a reconcile rebuild', async () => {
    await setInbox({ words: [], quotes: [quoteWithClozes([])] });
    await syncMetadataStorage.setValue({
      revision: 7,
      lastDigest: null,
      appSettingsUpdatedAt: 0,
      aiSettingsUpdatedAt: 0,
      state: {
        ...EMPTY_SYNC_STATE,
        quotes: {
          q1: {
            id: 'q1',
            fields: {},
            createdAt: { value: 100, stamp: { wallTime: 100, counter: 0, replicaId: 'A' } },
            tags: {},
            tagTombstones: {},
            clozes: {},
            clozeTombstones: { drop: { wallTime: 250, counter: 0, replicaId: 'A' } },
            reviewEvents: {},
          },
        },
      },
    });
    const cfg = await getSyncConfig();
    await setSyncConfig({ ...cfg, localRevision: 3 });

    await reconcileOnStartup();

    const meta = await syncMetadataStorage.getValue();
    expect(meta.state?.quotes.q1.clozeTombstones?.drop).toBeDefined();
  });

  it('lets a blank re-added after removal survive', async () => {
    const d = await deps();
    const blank: Cloze = { id: 'c1', start: 0, end: 2 };
    await setInbox({ words: [], quotes: [quoteWithClozes([blank])] });
    await runSyncPass(d);

    await applyClozeRemoval([{ quoteId: 'q1', clozeIds: ['c1'] }]);
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [{ ...quoteWithClozes([]), updatedAt: 300 }] });
    });
    await runSyncPass(d);
    expect((await getInbox()).quotes[0].clozes).toBeUndefined();

    // Same id added back afterwards — the fresh add stamp must beat the tombstone.
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [{ ...quoteWithClozes([blank]), updatedAt: 400 }] });
    });
    await runSyncPass(d);

    expect((await getInbox()).quotes[0].clozes?.map((c) => c.id)).toEqual(['c1']);
  });
});
