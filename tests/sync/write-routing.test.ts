// Verifies that inbox/settings/AI writes flow through the sole-writer broker,
// bumping the shared revision and marking syncConfig.pending.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  registerSyncMutationHandler,
  requestSyncMutation,
  SYNC_DEBOUNCE_ALARM,
} from '../../entrypoints/background/sync-mutation-handler';
import { syncMetadataStorage, mutateInboxSynced } from '../../lib/sync/mutations';
import { getSyncConfig, mutateSyncConfig } from '../../lib/sync/local';
import { saveWord, saveQuote } from '../../lib/capture';

const SRC = {
  sourceTitle: 'Test',
  sourceUrl: 'https://example.com',
  sourceDomain: 'example.com',
  surrounding: 'ctx',
  capturedAt: Date.now(),
};

describe('write routing — sole-writer broker', () => {
  beforeEach(() => fakeBrowser.reset());

  // ---- mutateInboxSynced ----

  it('mutateInboxSynced bumps the revision', async () => {
    const before = (await syncMetadataStorage.getValue()).revision;
    await mutateInboxSynced((inbox) => ({ ...inbox }));
    const after = (await syncMetadataStorage.getValue()).revision;
    expect(after).toBeGreaterThan(before);
  });

  it('mutateInboxSynced marks pending=true always', async () => {
    await mutateInboxSynced((inbox) => ({ ...inbox }));
    expect((await getSyncConfig()).pending).toBe(true);
  });

  it('mutateInboxSynced marks syncConfig.status=pending when vaultId is set', async () => {
    await mutateSyncConfig((c) => ({ ...c, vaultId: 'vault-xyz' }));
    await mutateInboxSynced((inbox) => ({ ...inbox }));
    expect((await getSyncConfig()).status).toBe('pending');
  });

  // ---- capture (saveWord / saveQuote) ----

  it('saveWord bumps the revision', async () => {
    const before = (await syncMetadataStorage.getValue()).revision;
    await saveWord('汉字', SRC);
    const after = (await syncMetadataStorage.getValue()).revision;
    expect(after).toBeGreaterThan(before);
  });

  it('saveWord marks pending=true', async () => {
    await saveWord('汉字', SRC);
    expect((await getSyncConfig()).pending).toBe(true);
  });

  it('saveWord sets status=pending when vault is configured', async () => {
    await mutateSyncConfig((c) => ({ ...c, vaultId: 'vault-abc' }));
    await saveWord('汉字', SRC);
    expect((await getSyncConfig()).status).toBe('pending');
  });

  it('saveQuote bumps the revision', async () => {
    const before = (await syncMetadataStorage.getValue()).revision;
    await saveQuote('学而时习之', SRC);
    const after = (await syncMetadataStorage.getValue()).revision;
    expect(after).toBeGreaterThan(before);
  });

  // ---- requestSyncMutation round-trips (broker) ----

  it('requestSyncMutation(inbox) bumps revision and marks pending', async () => {
    registerSyncMutationHandler();
    const before = (await syncMetadataStorage.getValue()).revision;
    await requestSyncMutation('inbox', { words: [], quotes: [] });
    const after = (await syncMetadataStorage.getValue()).revision;
    expect(after).toBeGreaterThan(before);
    expect((await getSyncConfig()).pending).toBe(true);
  });

  it('requestSyncMutation(settings) bumps revision', async () => {
    registerSyncMutationHandler();
    const before = (await syncMetadataStorage.getValue()).revision;
    await requestSyncMutation('settings', {
      uiLocale: 'zh-CN',
      kaikki: { enabled: false, sourceUrl: '', sourceName: '', hash: null, entryCount: 0, importedAt: null },
      srs: { desiredRetention: 0.9, maximumIntervalDays: 3650, newCardsPerDay: 20, enableFuzz: true },
    });
    const after = (await syncMetadataStorage.getValue()).revision;
    expect(after).toBeGreaterThan(before);
  });

  it('requestSyncMutation(ai) bumps revision', async () => {
    registerSyncMutationHandler();
    const before = (await syncMetadataStorage.getValue()).revision;
    await requestSyncMutation('ai', {
      enabled: false,
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: '',
    });
    const after = (await syncMetadataStorage.getValue()).revision;
    expect(after).toBeGreaterThan(before);
  });

  // ---- debounced sync alarm ----

  it('scheduleDebouncedSync creates shiyu:sync-debounce alarm when vaultId is set', async () => {
    registerSyncMutationHandler();
    await mutateSyncConfig((c) => ({ ...c, vaultId: 'vault-debounce-test' }));
    await requestSyncMutation('inbox', { words: [], quotes: [] });
    const alarms = await browser.alarms.getAll();
    expect(alarms.some((a) => a.name === SYNC_DEBOUNCE_ALARM)).toBe(true);
  });

  it('no debounce alarm is created when vaultId is absent', async () => {
    registerSyncMutationHandler();
    // vaultId is null by default after fakeBrowser.reset()
    await requestSyncMutation('inbox', { words: [], quotes: [] });
    const alarms = await browser.alarms.getAll();
    expect(alarms.some((a) => a.name === SYNC_DEBOUNCE_ALARM)).toBe(false);
  });
});
