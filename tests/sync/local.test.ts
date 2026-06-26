import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  getSyncConfig,
  makeReplicaId,
  mutateSyncConfig,
} from '../../lib/sync/local';
import { isReplicaFilename } from '../../lib/sync/vault';

describe('sync local config', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('defaults to disconnected', async () => {
    const cfg = await getSyncConfig();
    expect(cfg.vaultId).toBeNull();
    expect(cfg.status).toBe('disabled');
  });

  it('persists mutations', async () => {
    await mutateSyncConfig((cfg) => ({ ...cfg, replicaLabel: 'Laptop' }));
    expect((await getSyncConfig()).replicaLabel).toBe('Laptop');
  });

  it('generates ULID replica ids that match the filename grammar', () => {
    const bytes = new Uint8Array(10).fill(7);
    const id = makeReplicaId(1700000000000, bytes);
    expect(isReplicaFilename(`${id}.shiyu`)).toBe(true);
  });
});
