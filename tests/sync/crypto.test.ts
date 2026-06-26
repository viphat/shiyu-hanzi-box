import { describe, expect, it } from 'vitest';
import {
  checkVerification,
  decryptJson,
  defaultKdfParams,
  deriveKey,
  encryptJson,
  makeVerification,
} from '../../lib/sync/crypto';

const aad = new TextEncoder().encode('shiyu-hanzi-box|1|V1|R1');

describe('crypto round trip', () => {
  it('encrypts and decrypts with the correct key', async () => {
    const params = defaultKdfParams();
    const key = await deriveKey('correct horse', params);
    const { nonce, ciphertext } = await encryptJson(key, { hello: '世界' }, aad);
    const out = await decryptJson<{ hello: string }>(key, nonce, ciphertext, aad);
    expect(out.hello).toBe('世界');
  });

  it('uses a fresh nonce so identical plaintext differs', async () => {
    const key = await deriveKey('pw', defaultKdfParams());
    const a = await encryptJson(key, { x: 1 }, aad);
    const b = await encryptJson(key, { x: 1 }, aad);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('rejects tampered AAD', async () => {
    const key = await deriveKey('pw', defaultKdfParams());
    const { nonce, ciphertext } = await encryptJson(key, { x: 1 }, aad);
    const wrongAad = new TextEncoder().encode('shiyu-hanzi-box|1|V1|R2');
    await expect(decryptJson(key, nonce, ciphertext, wrongAad)).rejects.toThrow();
  });

  it('rejects the wrong passphrase via verification value', async () => {
    const params = defaultKdfParams();
    const v = await makeVerification(await deriveKey('right', params));
    expect(await checkVerification(await deriveKey('right', params), v)).toBe(true);
    expect(await checkVerification(await deriveKey('wrong', params), v)).toBe(false);
  });
});
