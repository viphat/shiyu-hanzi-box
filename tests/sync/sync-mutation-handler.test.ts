// tests/sync/sync-mutation-handler.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  registerSyncMutationHandler,
  requestSyncMutation,
} from '../../entrypoints/background/sync-mutation-handler';
import { applyTagRemoval, syncMetadataStorage } from '../../lib/sync/mutations';
import { EMPTY_SYNC_STATE } from '../../lib/sync/types';

describe('sync mutation broker', () => {
  beforeEach(() => fakeBrowser.reset());

  it('applies a mutation and bumps the revision', async () => {
    registerSyncMutationHandler();
    await requestSyncMutation('inbox', { words: [], quotes: [] });
    expect((await syncMetadataStorage.getValue()).revision).toBeGreaterThan(0);
  });
});

describe('applyTagRemoval', () => {
  beforeEach(() => fakeBrowser.reset());

  it('records tombstones for a batched multi-quote payload and bumps revision once', async () => {
    // Seed persisted state with two quotes that have tags (mirror existing seeding helper).
    await syncMetadataStorage.setValue({
      revision: 5,
      lastDigest: null,
      // appSettingsUpdatedAt / aiSettingsUpdatedAt are required SyncMetadata
      // fields (added in commit 762efa1); seed them as 0 ("unversioned").
      appSettingsUpdatedAt: 0,
      aiSettingsUpdatedAt: 0,
      state: {
        ...EMPTY_SYNC_STATE,
        quotes: {
          q1: { id: 'q1', fields: {}, createdAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } }, tags: { a: { wallTime: 1, counter: 0, replicaId: 'A' }, b: { wallTime: 1, counter: 0, replicaId: 'A' } }, tagTombstones: {}, reviewEvents: {} },
          q2: { id: 'q2', fields: {}, createdAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } }, tags: { a: { wallTime: 1, counter: 0, replicaId: 'A' } }, tagTombstones: {}, reviewEvents: {} },
        },
      },
    });

    await applyTagRemoval([
      { quoteId: 'q1', tags: ['a'] },
      { quoteId: 'q2', tags: ['a'] },
    ]);

    const meta = await syncMetadataStorage.getValue();
    expect(meta.revision).toBe(6); // bumped exactly once
    expect(meta.state!.quotes.q1.tagTombstones!.a).toBeDefined();
    expect(meta.state!.quotes.q2.tagTombstones!.a).toBeDefined();
    expect(meta.state!.quotes.q1.tagTombstones!.b).toBeUndefined();
  });

  it('creates the quote node and tagTombstones map if missing', async () => {
    await syncMetadataStorage.setValue({ revision: 0, lastDigest: null, appSettingsUpdatedAt: 0, aiSettingsUpdatedAt: 0, state: { ...EMPTY_SYNC_STATE } });
    await applyTagRemoval([{ quoteId: 'new', tags: ['x'] }]);
    const meta = await syncMetadataStorage.getValue();
    expect(meta.state!.quotes.new.tagTombstones!.x).toBeDefined();
  });
});
