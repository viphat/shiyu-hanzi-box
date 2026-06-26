// tests/sync/connect.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { createVaultOnFs, joinVaultOnFs } from '../../lib/sync/connect';

describe('vault create/join', () => {
  beforeEach(() => fakeBrowser.reset());

  it('refuses create when a vault already exists', async () => {
    const fs = new MemoryFs();
    await createVaultOnFs(fs, 'pw', 'A', 1000);
    await expect(createVaultOnFs(fs, 'pw', 'B', 2000)).rejects.toThrow('vault-exists');
  });

  it('joins with the correct passphrase and rejects the wrong one', async () => {
    const fs = new MemoryFs();
    await createVaultOnFs(fs, 'pw', 'A', 1000);
    await expect(joinVaultOnFs(fs, 'wrong', 'B', 2000)).rejects.toThrow('wrong-passphrase');
    const joined = await joinVaultOnFs(fs, 'pw', 'B', 2000);
    expect(joined.vaultId).toBeTruthy();
  });
});
