// Entity-level behavior of a backup restore on a synced profile. A restore is
// a local synchronized mutation that propagates (sync design §"Backup and
// Restore"), so it has to work in BOTH directions: an entry the backup drops
// must stay dropped, and an entry the backup carries must come back even if it
// was deleted here — otherwise restoring to undo a mistaken restore is
// impossible.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { runSyncPass } from '../../lib/sync/coordinator';
import { deriveKey, defaultKdfParams } from '../../lib/sync/crypto';
import { encryptReplica } from '../../lib/sync/vault';
import { projectInbox } from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import { applyDeletion, applyLocalMutation, applyRestore } from '../../lib/sync/mutations';
import { getSyncConfig, setSyncConfig } from '../../lib/sync/local';
import { getInbox, setInbox } from '../../lib/storage';
import type { Inbox, QuoteEntry, WordEntry } from '../../lib/types';
import type { SyncReplica } from '../../lib/sync/types';

const REPLICA_ID = '01J0AZ5K2YJ3M4N5P6Q7R8S9TW';

async function deps() {
  const key = await deriveKey('pw', defaultKdfParams());
  return { fs: new MemoryFs(), key, vaultId: 'V1', replicaId: REPLICA_ID, now: () => 1000 };
}

function quote(id: string): QuoteEntry {
  return {
    id,
    kind: 'quote',
    text: 'hi',
    note: '',
    status: 'inbox',
    tags: [],
    createdAt: 10,
    updatedAt: 20,
    sourceTitle: '',
    sourceUrl: '',
    sourceDomain: '',
    surrounding: '',
  };
}

function word(normalized: string): WordEntry {
  return {
    id: `w-${normalized}`,
    kind: 'word',
    text: normalized,
    normalized,
    note: '',
    status: 'inbox',
    createdAt: 10,
    updatedAt: 20,
    occurrences: [],
  };
}

async function seedRemote(fs: MemoryFs, key: CryptoKey, inbox: Inbox): Promise<void> {
  const state = projectInbox(inbox, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, {
    replicaId: 'R-REMOTE',
    wallTime: 500,
  });
  const replica: SyncReplica = {
    app: 'shiyu-hanzi-box',
    formatVersion: 1,
    vaultId: 'V1',
    replicaId: 'R-REMOTE',
    writtenAt: { wallTime: 500, counter: 0, replicaId: 'R-REMOTE' },
    state,
  };
  fs.seed('01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu', await encryptReplica(key, replica));
}

describe('backup restore, entity level', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    const cfg = await getSyncConfig();
    await setSyncConfig({ ...cfg, replicaId: REPLICA_ID, vaultId: 'V1' });
  });

  it('keeps an entry the backup drops from being brought back by a peer', async () => {
    const d = await deps();
    const before: Inbox = { words: [word('你好')], quotes: [quote('q1'), quote('q2')] };
    await setInbox(before);
    await runSyncPass(d);
    // Peer replica written before the restore — it still holds everything.
    await seedRemote(d.fs, d.key, before);

    await applyRestore({ words: [], quotes: [quote('q1')] });
    await runSyncPass(d);

    const inbox = await getInbox();
    expect(inbox.quotes.map((q) => q.id)).toEqual(['q1']);
    expect(inbox.words).toEqual([]);
  });

  it('brings back an entry the backup carries but this device deleted', async () => {
    const d = await deps();
    await setInbox({ words: [], quotes: [quote('q1')] });
    await runSyncPass(d);

    await applyDeletion(['quote:q1']);
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [] });
    });
    await runSyncPass(d);
    expect((await getInbox()).quotes).toHaveLength(0);

    // Restoring a backup taken before the delete must undo it: the entry's own
    // stamp is older than the tombstone, so the restore has to stamp it above.
    await applyRestore({ words: [], quotes: [quote('q1')] });
    await runSyncPass(d);

    expect((await getInbox()).quotes.map((q) => q.id)).toEqual(['q1']);
  });

  it('restores content that the current state would otherwise win by recency', async () => {
    const d = await deps();
    // The live note is NEWER than the backup's copy of the same quote, so the
    // backup's content loses LWW unless the restore re-stamps it.
    await setInbox({ words: [], quotes: [{ ...quote('q1'), note: 'edited later', updatedAt: 900 }] });
    await runSyncPass(d);

    await applyRestore({ words: [], quotes: [{ ...quote('q1'), note: 'from backup' }] });
    await runSyncPass(d);

    const restored = (await getInbox()).quotes[0];
    expect(restored.note).toBe('from backup');
    expect(restored.updatedAt).toBeGreaterThan(900);
  });

  it('undoes itself: restoring the newer backup after an older one', async () => {
    const d = await deps();
    const newer: Inbox = { words: [], quotes: [quote('q1'), quote('q2')] };
    await setInbox(newer);
    await runSyncPass(d);

    // Restore an older backup that predates q2 — q2 is tombstoned.
    await applyRestore({ words: [], quotes: [quote('q1')] });
    await runSyncPass(d);
    expect((await getInbox()).quotes.map((q) => q.id)).toEqual(['q1']);

    // Change of heart: restore the newer backup again. q2 must come back.
    await applyRestore(newer);
    await runSyncPass(d);
    expect((await getInbox()).quotes.map((q) => q.id).sort()).toEqual(['q1', 'q2']);
  });
});
