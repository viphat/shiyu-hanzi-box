// tests/sync/deletion-tombstones.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { runSyncPass } from '../../lib/sync/coordinator';
import { deriveKey, defaultKdfParams } from '../../lib/sync/crypto';
import { encryptReplica } from '../../lib/sync/vault';
import { projectInbox } from '../../lib/sync/project';
import { deleteEntity } from '../../lib/sync/merge';
import { applyDeletion, syncMetadataStorage } from '../../lib/sync/mutations';
import { getSyncConfig } from '../../lib/sync/local';
import { setInbox } from '../../lib/storage';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import { getInbox } from '../../lib/storage';
import type { SyncReplica } from '../../lib/sync/types';

async function deps() {
  const key = await deriveKey('pw', defaultKdfParams());
  return {
    fs: new MemoryFs(),
    key,
    vaultId: 'V1',
    replicaId: '01J0AZ5K2YJ3M4N5P6Q7R8S9TW',
    now: () => 2000,
  };
}

async function encryptRemoteReplica(
  key: CryptoKey,
  state: ReturnType<typeof projectInbox>,
): Promise<string> {
  const remote: SyncReplica = {
    app: 'shiyu-hanzi-box',
    formatVersion: 1,
    vaultId: 'V1',
    replicaId: '01J0AZ5K2YJ3M4N5P6Q7R8S9TV',
    writtenAt: { wallTime: 5, counter: 0, replicaId: '01J0AZ5K2YJ3M4N5P6Q7R8S9TV' },
    state,
  };
  return encryptReplica(key, remote);
}

describe('deletion tombstones', () => {
  beforeEach(() => fakeBrowser.reset());

  it('applyDeletion records a tombstone and bumps the revision', async () => {
    const cfgBefore = await getSyncConfig();
    const revBefore = cfgBefore.localRevision;

    await applyDeletion(['word:你好']);

    const meta = await syncMetadataStorage.getValue();
    const cfg = await getSyncConfig();

    expect(meta.state?.tombstones['word:你好']).toBeDefined();
    expect(cfg.localRevision).toBeGreaterThan(revBefore);
    expect(cfg.pending).toBe(true);
  });

  it('resurrection is prevented through a full sync pass', async () => {
    const d = await deps();
    const normalized = '远';
    const wordInInbox = {
      id: 'w1',
      kind: 'word' as const,
      text: '远',
      normalized,
      note: '',
      status: 'inbox' as const,
      createdAt: 5,
      updatedAt: 5,
      occurrences: [],
    };

    // Seed the local inbox with the word
    await setInbox({ words: [wordInInbox], quotes: [] });

    // Build a persisted state that has the word AND a tombstone for it
    const baseState = projectInbox(
      { words: [wordInInbox], quotes: [] },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      { replicaId: d.replicaId, wallTime: 5 },
    );
    // Record a tombstone at wallTime > word's updatedAt (5) so it wins
    const stateWithTombstone = deleteEntity(baseState, `word:${normalized}`, {
      wallTime: 6,
      counter: 0,
      replicaId: d.replicaId,
    });
    await syncMetadataStorage.setValue({
      revision: 1,
      state: stateWithTombstone,
      lastDigest: null,
      appSettingsUpdatedAt: 0,
      aiSettingsUpdatedAt: 0,
    });

    // Seed a remote replica that STILL contains the word (no tombstone)
    const remoteState = projectInbox(
      { words: [wordInInbox], quotes: [] },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      { replicaId: '01J0AZ5K2YJ3M4N5P6Q7R8S9TV', wallTime: 5 },
    );
    d.fs.seed(
      '01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu',
      await encryptRemoteReplica(d.key, remoteState),
    );

    await runSyncPass(d);

    const inbox = await getInbox();
    expect(inbox.words.some((w) => w.normalized === normalized)).toBe(false);
  });
});
