import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { runSyncPass, SyncCoordinator } from '../../lib/sync/coordinator';
import { deriveKey, defaultKdfParams } from '../../lib/sync/crypto';
import { encryptReplica } from '../../lib/sync/vault';
import { projectInbox } from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import { getInbox } from '../../lib/storage';
import type { SyncReplica } from '../../lib/sync/types';

async function deps() {
  const key = await deriveKey('pw', defaultKdfParams());
  return { fs: new MemoryFs(), key, vaultId: 'V1', replicaId: '01J0AZ5K2YJ3M4N5P6Q7R8S9TW', now: () => 1000 };
}

describe('runSyncPass', () => {
  beforeEach(() => fakeBrowser.reset());

  it('merges a remote replica into local state and writes own replica', async () => {
    const d = await deps();
    const remoteState = projectInbox(
      { words: [{ id: 'r', kind: 'word', text: '远', normalized: '远', note: '', status: 'inbox', createdAt: 5, updatedAt: 5, occurrences: [] }], quotes: [] },
      DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, { replicaId: 'R-REMOTE', wallTime: 5 },
    );
    const remote: SyncReplica = { app: 'shiyu-hanzi-box', formatVersion: 1, vaultId: 'V1', replicaId: 'R-REMOTE', writtenAt: { wallTime: 5, counter: 0, replicaId: 'R-REMOTE' }, state: remoteState };
    d.fs.seed('01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu', await encryptReplica(d.key, remote));

    const result = await runSyncPass(d);
    expect(result.status).toBe('synced');
    expect((await getInbox()).words.some((w) => w.normalized === '远')).toBe(true);
    expect((await d.fs.listReplicas()).length).toBe(2); // remote + own
  });

  it('warns and keeps pending on one corrupt replica', async () => {
    const d = await deps();
    d.fs.seed('01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu', 'not-json');
    const result = await runSyncPass(d);
    expect(result.warnings.some((w) => w.code === 'replica-incompatible')).toBe(true);
  });
});

describe('SyncCoordinator', () => {
  it('coalesces concurrent triggers into one pass plus one rerun', async () => {
    let passes = 0;
    const coord = new SyncCoordinator(async () => {
      passes += 1;
      await Promise.resolve();
      return { status: 'synced' as const, warnings: [] };
    });
    coord.trigger('a');
    coord.trigger('b');
    coord.trigger('c');
    await coord.idle();
    expect(passes).toBeLessThanOrEqual(2);
    expect(passes).toBeGreaterThanOrEqual(1);
  });
});
