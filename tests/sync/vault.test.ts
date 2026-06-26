import { describe, expect, it } from 'vitest';
import { deriveKey, defaultKdfParams } from '../../lib/sync/crypto';
import {
  decryptReplica,
  encryptReplica,
  isReplicaFilename,
  isVaultManifest,
} from '../../lib/sync/vault';
import { EMPTY_SYNC_STATE, type SyncReplica } from '../../lib/sync/types';

const replica: SyncReplica = {
  app: 'shiyu-hanzi-box',
  formatVersion: 1,
  vaultId: 'V1',
  replicaId: 'R1',
  writtenAt: { wallTime: 1, counter: 0, replicaId: 'R1' },
  state: EMPTY_SYNC_STATE,
};

describe('replica filenames', () => {
  it('accepts ULID .shiyu names and rejects conflict copies', () => {
    expect(isReplicaFilename('01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu')).toBe(true);
    expect(isReplicaFilename('01J0AZ5K2YJ3M4N5P6Q7R8S9TV (1).shiyu')).toBe(false);
    expect(isReplicaFilename('vault.json')).toBe(false);
  });
});

describe('replica encrypt/decrypt', () => {
  it('round-trips a replica with the right key and vault', async () => {
    const key = await deriveKey('pw', defaultKdfParams());
    const raw = await encryptReplica(key, replica);
    const out = await decryptReplica(key, raw, { vaultId: 'V1' });
    expect(out.replicaId).toBe('R1');
  });

  it('rejects a replica claiming a different vault id', async () => {
    const key = await deriveKey('pw', defaultKdfParams());
    const raw = await encryptReplica(key, replica);
    await expect(decryptReplica(key, raw, { vaultId: 'OTHER' })).rejects.toThrow();
  });
});

describe('vault manifest validation', () => {
  it('rejects foreign or unversioned manifests', () => {
    expect(isVaultManifest({ app: 'other' })).toBe(false);
    expect(isVaultManifest(null)).toBe(false);
  });
});
