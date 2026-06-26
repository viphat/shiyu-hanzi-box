// lib/sync/coordinator.ts
import { mergeSyncState } from './merge';
import { materialize, projectInbox } from './project';
import { decryptReplica, encryptReplica } from './vault';
import { setInbox } from '../storage';
import { replaceSettings, getSettings } from '../settings';
import { aiSettingsStorage } from '../ai/settings';
import { applyLocalMutation, readDomainSnapshot, syncMetadataStorage } from './mutations';
import { getSyncConfig, makeReplicaId, mutateSyncConfig } from './local';
import type { SyncError, SyncReplica, SyncState, SyncStatus } from './types';
import type { SyncFs } from './files';

export interface SyncDeps {
  fs: SyncFs;
  key: CryptoKey;
  vaultId: string;
  replicaId: string;
  now(): number;
}

export async function runSyncPass(
  deps: SyncDeps,
): Promise<{ status: SyncStatus; warnings: SyncError[] }> {
  const warnings: SyncError[] = [];

  // Local state -> sync state.
  const { inbox, settings, ai } = await readDomainSnapshot();
  let merged: SyncState = projectInbox(inbox, settings, ai, {
    replicaId: deps.replicaId,
    wallTime: deps.now(),
  });

  // Read + merge every readable compatible replica.
  for (const name of await deps.fs.listReplicas()) {
    try {
      const raw = await deps.fs.readFile(name);
      const replica = await decryptReplica(deps.key, raw, { vaultId: deps.vaultId });
      merged = mergeSyncState(merged, replica.state);
    } catch (err) {
      const code = (err as Error).message;
      warnings.push({
        code: code === 'vault-invalid' ? 'vault-invalid' : 'replica-incompatible',
        replica: name,
      });
    }
  }

  // Persist merged domain through the broker (sole writer).
  const out = materialize(merged);
  await applyLocalMutation('inbox', async () => {
    await setInbox(out.inbox);
    const current = await getSettings();
    await replaceSettings({
      ...current,
      uiLocale: out.portableSettings.uiLocale,
      srs: out.portableSettings.srs,
      kaikki: { ...current.kaikki, sourceUrl: out.kaikkiSource.sourceUrl, sourceName: out.kaikkiSource.sourceName },
    });
    await aiSettingsStorage.setValue(out.ai);
  });
  // Capture the revision right after our own write — this is the expected revision.
  const revisionAfterOwnWrite = (await getSyncConfig()).localRevision;
  await syncMetadataStorage.setValue({
    ...(await syncMetadataStorage.getValue()),
    state: merged,
  });

  // Encrypt + write own replica.
  const replica: SyncReplica = {
    app: 'shiyu-hanzi-box',
    formatVersion: 1,
    vaultId: deps.vaultId,
    replicaId: deps.replicaId,
    writtenAt: { wallTime: deps.now(), counter: 0, replicaId: deps.replicaId },
    state: merged,
  };
  const ownFilename = `${makeReplicaId(deps.now(), crypto.getRandomValues(new Uint8Array(10)))}.shiyu`;
  try {
    await deps.fs.writeFile(ownFilename, await encryptReplica(deps.key, replica));
  } catch {
    await mutateSyncConfig((c) => ({ ...c, pending: true, status: 'needs-attention', lastError: { code: 'write-failure' } }));
    return { status: 'needs-attention', warnings };
  }

  // If a new local mutation came in during the pass, stay pending.
  const revisionFinal = (await getSyncConfig()).localRevision;
  const stillPending = revisionFinal !== revisionAfterOwnWrite || warnings.length > 0;
  const status: SyncStatus = warnings.length > 0 ? 'pending' : stillPending ? 'pending' : 'synced';
  await mutateSyncConfig((c) => ({
    ...c,
    pending: stillPending,
    status,
    lastSuccessAt: warnings.length === 0 ? deps.now() : c.lastSuccessAt,
    lastError: warnings[0] ?? null,
  }));
  return { status, warnings };
}

type PassFn = () => Promise<{ status: SyncStatus; warnings: SyncError[] }>;

export class SyncCoordinator {
  private running = false;
  private rerun = false;
  private active: Promise<void> = Promise.resolve();

  constructor(private readonly pass: PassFn) {}

  trigger(_reason: string): void {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    this.active = this.loop();
  }

  private async loop(): Promise<void> {
    try {
      do {
        this.rerun = false;
        await this.pass();
      } while (this.rerun);
    } finally {
      this.running = false;
    }
  }

  idle(): Promise<void> {
    return this.active;
  }
}
