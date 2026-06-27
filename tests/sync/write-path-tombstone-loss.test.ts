// tests/sync/write-path-tombstone-loss.test.ts
//
// Reproduces the tombstone-loss exposure introduced when inbox writes were
// routed through the sole-writer broker (commit 06a5332). The dashboard delete
// flow (entrypoints/dashboard/App.tsx:172-173) fires, in order:
//
//   1. requestSyncMutation('delete', [...])  -> applyDeletion       (writes a
//      tombstone INTO the persisted SyncState, preserving state)
//   2. mutate(...)  -> applyLocalMutation('inbox', ...)             (sets
//      meta.state = null — wiping the tombstone written in step 1)
//
// Because the tombstone only lived in meta.state, and it has not yet been
// flushed into a replica file, the next sync pass starts from `persisted = null`
// and merges the own replica (which still holds the entity with NO tombstone) —
// resurrecting the deleted entity.
//
// This is the same write-path shape the planned `removeTags` mutation would use
// (applyTagRemoval writes a tag tombstone, then setQuoteTags' mutate nulls it),
// so a green result here would prove the quote-tags carry-forward design cannot
// rely on `persisted` being non-null on a normal pass.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { runSyncPass } from '../../lib/sync/coordinator';
import { deriveKey, defaultKdfParams } from '../../lib/sync/crypto';
import {
  applyDeletion,
  applyLocalMutation,
  syncMetadataStorage,
} from '../../lib/sync/mutations';
import { setSyncConfig, getSyncConfig } from '../../lib/sync/local';
import { getInbox, setInbox } from '../../lib/storage';
import type { WordEntry } from '../../lib/types';

const REPLICA_ID = '01J0AZ5K2YJ3M4N5P6Q7R8S9TW';

async function deps() {
  const key = await deriveKey('pw', defaultKdfParams());
  return {
    fs: new MemoryFs(),
    key,
    vaultId: 'V1',
    replicaId: REPLICA_ID,
    now: () => 2000,
  };
}

function word(): WordEntry {
  return {
    id: 'w1',
    kind: 'word',
    text: '远',
    normalized: '远',
    note: '',
    status: 'inbox',
    createdAt: 5,
    updatedAt: 5,
    occurrences: [],
  };
}

describe('broker write-path tombstone loss (delete flow)', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    // Pin the replica id so applyDeletion's ensureReplicaId() and the pass write
    // the same own-replica filename.
    const cfg = await getSyncConfig();
    await setSyncConfig({ ...cfg, replicaId: REPLICA_ID, vaultId: 'V1' });
  });

  it('an inbox edit preserves the SyncState tombstone', async () => {
    await applyDeletion(['word:远']);
    expect((await syncMetadataStorage.getValue()).state?.tombstones['word:远']).toBeDefined();

    // The very next inbox write (any unrelated edit) goes through the broker.
    // After the fix, the persisted state is NOT nulled — the tombstone survives.
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [] });
    });

    const meta = await syncMetadataStorage.getValue();
    expect(meta.state).not.toBeNull();
    expect(meta.state?.tombstones['word:远']).toBeDefined();
  });

  it('a deleted entity stays deleted through the next pass when the delete is followed by an inbox edit', async () => {
    const d = await deps();

    // 1. Establish a synced baseline: inbox has the word, own replica + persisted
    //    state get written by a normal pass.
    await setInbox({ words: [word()], quotes: [] });
    await runSyncPass(d);
    expect((await getInbox()).words.some((w) => w.normalized === '远')).toBe(true);

    // 2. Real dashboard delete flow: tombstone first, then the inbox mutate that
    //    nulls the persisted state.
    await applyDeletion(['word:远']);
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [] });
    });

    // 3. Next pass. The own replica from step 1 still holds the word (no
    //    tombstone), and persisted state is null, so nothing suppresses it.
    await runSyncPass(d);

    const inbox = await getInbox();
    // EXPECTED (correct behavior): the word stays deleted.
    expect(inbox.words.some((w) => w.normalized === '远')).toBe(false);
  });
});
