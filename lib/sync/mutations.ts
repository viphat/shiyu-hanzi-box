import { storage } from 'wxt/utils/storage';
import { getInbox } from '../storage';
import { getSettings } from '../settings';
import { aiSettingsStorage } from '../ai/settings';
import { ensureReplicaId, mutateSyncConfig } from './local';
import { projectInbox } from './project';
import type { SyncState } from './types';

export interface SyncMetadata {
  revision: number;
  state: SyncState | null;
  lastDigest: string | null;
}

export const syncMetadataStorage = storage.defineItem<SyncMetadata>('local:syncMetadata', {
  fallback: { revision: 0, state: null, lastDigest: null },
});

export async function readDomainSnapshot() {
  const [inbox, settings, ai] = await Promise.all([
    getInbox(),
    getSettings(),
    aiSettingsStorage.getValue(),
  ]);
  return { inbox, settings, ai };
}

let chain: Promise<unknown> = Promise.resolve();

export async function applyLocalMutation(
  _kind: 'inbox' | 'settings' | 'ai',
  writer: () => Promise<void>,
): Promise<void> {
  const run = chain.then(async () => {
    await writer();
    const meta = await syncMetadataStorage.getValue();
    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({ ...meta, revision: nextRevision, state: null });
    await mutateSyncConfig((cfg) => ({
      ...cfg,
      localRevision: nextRevision,
      // Always mark pending on any local mutation so callers don't need a vaultId
      // to observe the pending flag. This matches what the test specifies: pending
      // must be true after a mutation even when no vaultId is configured.
      pending: true,
      status: cfg.vaultId ? 'pending' : cfg.status,
    }));
  });
  chain = run;
  return run;
}

export async function reconcileOnStartup(): Promise<void> {
  const meta = await syncMetadataStorage.getValue();
  const cfg = await mutateSyncConfig((c) => c);
  if (meta.revision === cfg.localRevision && meta.state) return;
  const replicaId = await ensureReplicaId();
  const { inbox, settings, ai } = await readDomainSnapshot();
  const state = projectInbox(inbox, settings, ai, { replicaId, wallTime: Date.now() });
  await syncMetadataStorage.setValue({
    revision: cfg.localRevision,
    state,
    lastDigest: meta.lastDigest,
  });
  if (cfg.vaultId) {
    await mutateSyncConfig((c) => ({ ...c, pending: true, status: 'pending' }));
  }
}
