import { checkVerification, defaultKdfParams, deriveKey, makeVerification } from './crypto';
import { decryptReplica, encryptReplica, isVaultManifest, type VaultManifest } from './vault';
import { mergeSyncState } from './merge';
import { materialize, projectInbox } from './project';
import { readDomainSnapshot, applyLocalMutation, syncMetadataStorage } from './mutations';
import { ensureReplicaId, mutateSyncConfig } from './local';
import { setInbox } from '../storage';
import { getSettings, replaceSettings } from '../settings';
import { aiSettingsStorage } from '../ai/settings';
import { APP_ID, VAULT_FORMAT_VERSION, type SyncReplica, type SyncState } from './types';
import type { SyncFs } from './files';

export const SYNC_ALARM = 'shiyu:sync';

/**
 * Registers sync alarms for debounced + periodic reconciliation.
 * The full alarm-listener handler that drives the coordinator is wired in Task 17.
 */
export function registerSyncAlarms(): void {
  // Task 17 will wire the full coordinator handler on the alarm event.
  // Here we just ensure the periodic alarm exists.
  browser.alarms.create(SYNC_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: 5,
  });
}

function makeVaultId(random: Uint8Array): string {
  return [...random].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createVaultOnFs(
  fs: SyncFs,
  passphrase: string,
  label: string,
  now: number,
): Promise<{ vaultId: string; key: CryptoKey }> {
  if (await fs.readManifest()) throw new Error('vault-exists');
  const kdf = defaultKdfParams();
  const key = await deriveKey(passphrase, kdf);
  const vaultId = makeVaultId(crypto.getRandomValues(new Uint8Array(16)));
  const manifest: VaultManifest = {
    app: APP_ID,
    vaultFormatVersion: VAULT_FORMAT_VERSION,
    vaultId,
    kdf,
    cipher: 'AES-256-GCM',
    verification: await makeVerification(key),
  };
  await fs.writeManifest(JSON.stringify(manifest));

  const replicaId = await ensureReplicaId();
  const { inbox, settings, ai } = await readDomainSnapshot();
  const meta = await syncMetadataStorage.getValue();
  const state = projectInbox(inbox, settings, ai, {
    replicaId,
    wallTime: now,
    settingsStamp: meta.appSettingsUpdatedAt,
    aiStamp: meta.aiSettingsUpdatedAt,
  });
  await writeOwnReplica(fs, key, vaultId, replicaId, state, now);
  await persistConnection(vaultId, label, state);
  return { vaultId, key };
}

export async function joinVaultOnFs(
  fs: SyncFs,
  passphrase: string,
  label: string,
  now: number,
): Promise<{ vaultId: string; key: CryptoKey }> {
  const rawManifest = await fs.readManifest();
  if (!rawManifest) throw new Error('vault-invalid');
  const manifest: unknown = JSON.parse(rawManifest);
  if (!isVaultManifest(manifest)) throw new Error('vault-invalid');
  const key = await deriveKey(passphrase, manifest.kdf);
  if (!(await checkVerification(key, manifest.verification))) throw new Error('wrong-passphrase');

  // Merge remote replicas first.
  let remote: SyncState | null = null;
  for (const name of await fs.listReplicas()) {
    try {
      const replica = await decryptReplica(key, await fs.readFile(name), { vaultId: manifest.vaultId });
      remote = remote ? mergeSyncState(remote, replica.state) : replica.state;
    } catch {
      // skip unreadable replica; do not assume deletion
    }
  }

  const replicaId = await ensureReplicaId();
  const { inbox, settings, ai } = await readDomainSnapshot();
  const meta = await syncMetadataStorage.getValue();
  // Stamp settings/AI with the joiner's real edit time (0 = never edited).
  // A fresh joiner with epoch-stamped (0) settings correctly loses to the
  // vault's real-stamped settings in mergeSyncState — the join-wipe is fixed
  // without changing the merge order.
  const local = projectInbox(inbox, settings, ai, {
    replicaId,
    wallTime: now,
    settingsStamp: meta.appSettingsUpdatedAt,
    aiStamp: meta.aiSettingsUpdatedAt,
  });
  // Established vault: remote portable settings win; local inbox still merges.
  const merged = remote ? mergeSyncState(remote, local) : local;

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
  await writeOwnReplica(fs, key, manifest.vaultId, replicaId, merged, now);
  await persistConnection(manifest.vaultId, label, merged);
  return { vaultId: manifest.vaultId, key };
}

async function writeOwnReplica(
  fs: SyncFs,
  key: CryptoKey,
  vaultId: string,
  replicaId: string,
  state: SyncState,
  now: number,
): Promise<void> {
  const replica: SyncReplica = {
    app: APP_ID,
    formatVersion: 1,
    vaultId,
    replicaId,
    writtenAt: { wallTime: now, counter: 0, replicaId },
    state,
  };
  await fs.writeFile(`${replicaId}.shiyu`, await encryptReplica(key, replica));
}

async function persistConnection(vaultId: string, label: string, state: SyncState): Promise<void> {
  await syncMetadataStorage.setValue({
    ...(await syncMetadataStorage.getValue()),
    state,
  });
  await mutateSyncConfig((cfg) => ({
    ...cfg,
    vaultId,
    replicaLabel: label || cfg.replicaLabel,
    status: 'synced',
    pending: false,
    lastError: null,
  }));
}

/**
 * Public wrapper: opens SyncFs from a directory handle, creates vault, persists handle + key.
 */
export async function createVault(
  parent: FileSystemDirectoryHandle,
  passphrase: string,
  label: string,
  now: number,
): Promise<{ vaultId: string }> {
  const { openSyncFs } = await import('./files');
  const { saveDirectoryHandle, rememberKey } = await import('./local');
  const fs = await openSyncFs(parent);
  const result = await createVaultOnFs(fs, passphrase, label, now);
  await saveDirectoryHandle(parent);
  await rememberKey(result.key);
  return { vaultId: result.vaultId };
}

/**
 * Public wrapper: opens SyncFs from a directory handle, joins vault, persists handle + key.
 */
export async function joinVault(
  parent: FileSystemDirectoryHandle,
  passphrase: string,
  label: string,
  now: number,
): Promise<{ vaultId: string }> {
  const { openSyncFs } = await import('./files');
  const { saveDirectoryHandle, rememberKey } = await import('./local');
  const fs = await openSyncFs(parent);
  const result = await joinVaultOnFs(fs, passphrase, label, now);
  await rememberKey(result.key);
  await saveDirectoryHandle(parent);
  return { vaultId: result.vaultId };
}

/**
 * Disconnects from the vault: clears directory handle, vault association, and remembered key.
 * Preserves local data and the files in the sync folder.
 */
export async function disconnect(): Promise<void> {
  const { clearDirectoryHandle, forgetKey } = await import('./local');
  await clearDirectoryHandle();
  await forgetKey();
  await mutateSyncConfig((cfg) => ({
    ...cfg,
    vaultId: null,
    status: 'disabled',
    pending: false,
    lastError: null,
  }));
}
