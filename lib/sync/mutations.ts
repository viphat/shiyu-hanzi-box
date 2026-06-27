import { storage } from 'wxt/utils/storage';
import { getInbox, setInbox } from '../storage';
import { getSettings } from '../settings';
import { aiSettingsStorage } from '../ai/settings';
import { ensureReplicaId, mutateSyncConfig } from './local';
import type { Inbox } from '../types';
import { projectInbox } from './project';
import { deleteEntity } from './merge';
import { EMPTY_SYNC_STATE, type SyncState } from './types';

export interface SyncMetadata {
  revision: number;
  state: SyncState | null;
  lastDigest: string | null;
  /** Wall-clock ms when the user last edited app settings. 0 = never edited (unversioned). */
  appSettingsUpdatedAt: number;
  /** Wall-clock ms when the user last edited AI settings. 0 = never edited (unversioned). */
  aiSettingsUpdatedAt: number;
}

export const syncMetadataStorage = storage.defineItem<SyncMetadata>('local:syncMetadata', {
  fallback: { revision: 0, state: null, lastDigest: null, appSettingsUpdatedAt: 0, aiSettingsUpdatedAt: 0 },
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
  kind: 'inbox' | 'settings' | 'ai',
  writer: () => Promise<void>,
): Promise<void> {
  const run = chain.then(async () => {
    await writer();
    const meta = await syncMetadataStorage.getValue();
    const nextRevision = meta.revision + 1;
    const now = Date.now();
    await syncMetadataStorage.setValue({
      ...meta,
      revision: nextRevision,
      state: null,
      appSettingsUpdatedAt: kind === 'settings' ? now : meta.appSettingsUpdatedAt,
      aiSettingsUpdatedAt: kind === 'ai' ? now : meta.aiSettingsUpdatedAt,
    });
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

/**
 * Revision-guarded write: atomically checks that no concurrent local mutation
 * has landed since `expectedRevision` was captured, then runs the writer and
 * bumps the revision exactly like applyLocalMutation.
 *
 * Runs on the same module-level `chain` as applyLocalMutation so it is FIFO
 * w.r.t. other writes — the revision check inside the chained body sees any
 * write that was queued before this call.
 *
 * Returns true if the write was committed; false if the revision had changed
 * (a concurrent write landed — caller should abort and retry).
 */
export async function applyLocalMutationIfUnchanged(
  _kind: 'inbox' | 'settings' | 'ai', // coordinator's merged write — must NOT bump settings timestamps
  expectedRevision: number,
  writer: () => Promise<void>,
): Promise<boolean> {
  let committed = false;
  const run = chain.then(async () => {
    // Use the metadata revision as the canonical source — it is written inside
    // the same mutations chain body (fully awaited) so it is always consistent
    // with any concurrent applyLocalMutation that ran before this slot.
    const meta = await syncMetadataStorage.getValue();
    if (meta.revision !== expectedRevision) {
      // A concurrent local write landed — abort without writing or bumping.
      committed = false;
      return;
    }
    await writer();
    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({ ...meta, revision: nextRevision, state: null });
    await mutateSyncConfig((c) => ({
      ...c,
      localRevision: nextRevision,
      pending: c.vaultId ? true : c.pending,
      status: c.vaultId ? 'pending' : c.status,
    }));
    committed = true;
  });
  chain = run;
  await run;
  return committed;
}

/**
 * Synced read-modify-write for inbox, for background callers (e.g. capture).
 * Runs inside applyLocalMutation's chain so the revision is bumped atomically.
 */
export async function mutateInboxSynced(fn: (inbox: Inbox) => Inbox): Promise<Inbox> {
  let result: Inbox | undefined;
  await applyLocalMutation('inbox', async () => {
    const inbox = await getInbox();
    result = fn(inbox);
    await setInbox(result);
  });
  return result!;
}

export async function applyDeletion(keys: string[]): Promise<void> {
  const run = chain.then(async () => {
    const replicaId = await ensureReplicaId();
    const meta = await syncMetadataStorage.getValue();
    let state: SyncState = meta.state ?? JSON.parse(JSON.stringify(EMPTY_SYNC_STATE)) as SyncState;
    for (const key of keys) {
      state = deleteEntity(state, key, { wallTime: Date.now(), counter: 0, replicaId });
    }
    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({
      revision: nextRevision,
      state,
      lastDigest: meta.lastDigest,
      appSettingsUpdatedAt: meta.appSettingsUpdatedAt,
      aiSettingsUpdatedAt: meta.aiSettingsUpdatedAt,
    });
    await mutateSyncConfig((cfg) => ({
      ...cfg,
      localRevision: nextRevision,
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
  const state = projectInbox(inbox, settings, ai, {
    replicaId,
    wallTime: Date.now(),
    settingsStamp: meta.appSettingsUpdatedAt,
    aiStamp: meta.aiSettingsUpdatedAt,
  });
  await syncMetadataStorage.setValue({
    revision: cfg.localRevision,
    state,
    lastDigest: meta.lastDigest,
    appSettingsUpdatedAt: meta.appSettingsUpdatedAt,
    aiSettingsUpdatedAt: meta.aiSettingsUpdatedAt,
  });
  if (cfg.vaultId) {
    await mutateSyncConfig((c) => ({ ...c, pending: true, status: 'pending' }));
  }
}
