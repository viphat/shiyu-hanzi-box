// tests/sync/coordinator-guard.test.ts
//
// Proves the no-clobber guarantee added in fix/sync-review-followups:
//   1. applyLocalMutationIfUnchanged unit behaviour (abort vs commit).
//   2. runSyncPass does not clobber a concurrent local write that lands during
//      the replica I/O window.
//   3. 'syncing' status is set at the start of a pass.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { runSyncPass } from '../../lib/sync/coordinator';
import { deriveKey, defaultKdfParams } from '../../lib/sync/crypto';
import { applyLocalMutation, applyLocalMutationIfUnchanged, syncMetadataStorage } from '../../lib/sync/mutations';
import { getSyncConfig, mutateSyncConfig } from '../../lib/sync/local';
import { getInbox, setInbox } from '../../lib/storage';
import { encryptReplica } from '../../lib/sync/vault';
import { projectInbox } from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import type { SyncFs } from '../../lib/sync/files';
import type { SyncStatus } from '../../lib/sync/types';

async function makeDeps(fs?: SyncFs) {
  const key = await deriveKey('pw', defaultKdfParams());
  return {
    fs: fs ?? new MemoryFs(),
    key,
    vaultId: 'V1',
    replicaId: '01J0AZ5K2YJ3M4N5P6Q7R8S9TW',
    now: () => 1000,
  };
}

// ---------------------------------------------------------------------------
// 1. applyLocalMutationIfUnchanged unit tests
// ---------------------------------------------------------------------------
describe('applyLocalMutationIfUnchanged', () => {
  beforeEach(() => fakeBrowser.reset());

  it('returns true and bumps revision when localRevision matches expected', async () => {
    // Start at revision 0 (fallback).
    const before = await getSyncConfig();
    expect(before.localRevision).toBe(0);

    let writerRan = false;
    const committed = await applyLocalMutationIfUnchanged('inbox', 0, async () => {
      writerRan = true;
    });

    expect(committed).toBe(true);
    expect(writerRan).toBe(true);
    const cfg = await getSyncConfig();
    expect(cfg.localRevision).toBe(1);
    const meta = await syncMetadataStorage.getValue();
    expect(meta.revision).toBe(1);
  });

  it('returns false and does NOT write or bump when localRevision differs', async () => {
    // First bump the revision via a normal mutation.
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [] });
    });
    const cfgAfterMutation = await getSyncConfig();
    expect(cfgAfterMutation.localRevision).toBe(1);

    // Now try to guard-write with the stale baseline of 0 — should abort.
    let writerRan = false;
    const committed = await applyLocalMutationIfUnchanged('inbox', 0, async () => {
      writerRan = true;
    });

    expect(committed).toBe(false);
    expect(writerRan).toBe(false);
    // Revision must NOT have been bumped again.
    const cfgAfter = await getSyncConfig();
    expect(cfgAfter.localRevision).toBe(1);
  });

  it('is FIFO with applyLocalMutation — a queued write is seen by the revision check', async () => {
    // Kick off a normal mutation that will settle the chain first.
    const mutationDone = applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [] });
    });

    // Queue a guarded write with the OLD baseline (0) — it should abort because
    // the mutation above will have bumped the revision to 1 before this runs.
    let guarded: boolean | undefined;
    const guardedDone = applyLocalMutationIfUnchanged('inbox', 0, async () => {
      guarded = true;
    }).then((v) => { guarded = v; });

    await mutationDone;
    await guardedDone;

    expect(guarded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. No-clobber integration test
// ---------------------------------------------------------------------------
describe('runSyncPass no-clobber', () => {
  beforeEach(() => fakeBrowser.reset());

  it('aborts the domain write and returns pending when a write lands during the pass', async () => {
    // Seed initial inbox state.
    await setInbox({ words: [], quotes: [] });

    // A MemoryFs whose readFile injects a concurrent local write the first time
    // it is called, simulating a user capture arriving during I/O.
    let intercepted = false;
    const concurrentWord = {
      id: 'concurrent',
      kind: 'word' as const,
      text: '并发',
      normalized: '并发',
      note: '',
      status: 'inbox' as const,
      createdAt: 999,
      updatedAt: 999,
      occurrences: [],
    };

    const baseFs = new MemoryFs();
    const injectingFs: SyncFs = {
      listReplicas: () => baseFs.listReplicas(),
      readFile: async (name: string) => {
        if (!intercepted) {
          intercepted = true;
          // This write arrives DURING the I/O window — it should NOT be clobbered.
          await applyLocalMutation('inbox', async () => {
            await setInbox({ words: [concurrentWord], quotes: [] });
          });
        }
        return baseFs.readFile(name);
      },
      writeFile: (name, contents) => baseFs.writeFile(name, contents),
      readManifest: () => baseFs.readManifest(),
      writeManifest: (contents) => baseFs.writeManifest(contents),
    };

    // Seed a dummy replica so listReplicas has a valid entry for readFile to be called.
    // Must use a valid 26-char Crockford ULID for isReplicaFilename to pass.
    const REMOTE_ID = '01J0AZ5K2YJ3M4N5P6Q7R8S9TV';
    const deps = await makeDeps(injectingFs);
    const remoteState = projectInbox(
      { words: [], quotes: [] },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      { replicaId: REMOTE_ID, wallTime: 1 },
    );
    const remoteReplica = {
      app: 'shiyu-hanzi-box' as const,
      formatVersion: 1 as const,
      vaultId: 'V1',
      replicaId: REMOTE_ID,
      writtenAt: { wallTime: 1, counter: 0, replicaId: REMOTE_ID },
      state: remoteState,
    };
    baseFs.seed(`${REMOTE_ID}.shiyu`, await encryptReplica(deps.key, remoteReplica));

    const result = await runSyncPass(deps);

    // The pass should have detected the concurrent write and returned 'pending'.
    expect(result.status).toBe('pending');

    // CRITICAL: the concurrently-written word must NOT have been clobbered.
    const inbox = await getInbox();
    expect(inbox.words.some((w) => w.normalized === '并发')).toBe(true);
  });

  it('ends synced (no concurrent write)', async () => {
    await setInbox({ words: [], quotes: [] });
    const deps = await makeDeps();
    const result = await runSyncPass(deps);
    expect(result.status).toBe('synced');
  });
});

// ---------------------------------------------------------------------------
// 3. 'syncing' status is set at the start of a pass
// ---------------------------------------------------------------------------
describe('runSyncPass syncing status', () => {
  beforeEach(() => fakeBrowser.reset());

  it('sets status to syncing before any replica I/O', async () => {
    let statusDuringRead: SyncStatus | undefined;

    const spyFs: SyncFs = {
      listReplicas: async () => {
        // At this point the pass has started — read the config to observe status.
        const cfg = await getSyncConfig();
        statusDuringRead = cfg.status;
        return [];
      },
      readFile: () => Promise.reject(new Error('should not be called')),
      writeFile: (_name, _contents) => Promise.resolve(),
      readManifest: () => Promise.resolve(null),
      writeManifest: () => Promise.resolve(),
    };

    // Ensure vault is configured so mutateSyncConfig sets a meaningful status.
    await mutateSyncConfig((c) => ({ ...c, vaultId: 'V1', status: 'pending' }));

    const deps = await makeDeps(spyFs);
    await runSyncPass(deps);

    expect(statusDuringRead).toBe('syncing');
  });
});
