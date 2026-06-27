import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { createVaultOnFs, joinVaultOnFs } from '../../lib/sync/connect';
import { deriveKey, makeVerification } from '../../lib/sync/crypto';

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

  it('refuses to join a vault whose manifest downgrades the KDF work factor', async () => {
    const fs = new MemoryFs();
    // Attacker pre-seeds a manifest with iterations: 1 and a verification blob
    // authored under those weakened parameters (so checkVerification would pass).
    const weakKdf = {
      algorithm: 'PBKDF2-HMAC-SHA-256',
      iterations: 1,
      salt: btoa('0123456789abcdef'),
    } as const;
    const key = await deriveKey('pw', weakKdf);
    const manifest = {
      app: 'shiyu-hanzi-box',
      vaultFormatVersion: 1,
      vaultId: 'attacker',
      kdf: weakKdf,
      cipher: 'AES-256-GCM',
      verification: await makeVerification(key),
    };
    await fs.writeManifest(JSON.stringify(manifest));
    await expect(joinVaultOnFs(fs, 'pw', 'B', 2000)).rejects.toThrow('vault-invalid');
  });
});
