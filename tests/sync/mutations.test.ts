import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applyLocalMutation, reconcileOnStartup, syncMetadataStorage } from '../../lib/sync/mutations';
import { getSyncConfig } from '../../lib/sync/local';
import { setInbox } from '../../lib/storage';

describe('local mutation protocol', () => {
  beforeEach(() => fakeBrowser.reset());

  it('bumps a shared revision and marks pending', async () => {
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [] });
    });
    const cfg = await getSyncConfig();
    const meta = await syncMetadataStorage.getValue();
    expect(cfg.pending).toBe(true);
    expect(cfg.localRevision).toBe(meta.revision);
    expect(cfg.localRevision).toBeGreaterThan(0);
  });

  it('reconciles mismatched revisions without dropping domain data', async () => {
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [] });
    });
    // Simulate an interrupted write: metadata revision behind config.
    await syncMetadataStorage.setValue({ revision: 0, state: null, lastDigest: null, appSettingsUpdatedAt: 0, aiSettingsUpdatedAt: 0 });
    await reconcileOnStartup();
    const cfg = await getSyncConfig();
    const meta = await syncMetadataStorage.getValue();
    expect(meta.revision).toBe(cfg.localRevision);
    expect(meta.state).not.toBeNull();
    expect(cfg.pending).toBe(true);
  });
});
