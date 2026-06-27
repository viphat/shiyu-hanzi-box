import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  registerSyncMutationHandler,
  requestSyncMutation,
} from '../../entrypoints/background/sync-mutation-handler';
import { syncMetadataStorage } from '../../lib/sync/mutations';

describe('sync mutation broker', () => {
  beforeEach(() => fakeBrowser.reset());

  it('applies a mutation and bumps the revision', async () => {
    registerSyncMutationHandler();
    await requestSyncMutation('inbox', { words: [], quotes: [] });
    expect((await syncMetadataStorage.getValue()).revision).toBeGreaterThan(0);
  });
});
