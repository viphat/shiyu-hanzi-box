import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applyOccurrenceRemoval, syncMetadataStorage } from '../../lib/sync/mutations';
import { EMPTY_SYNC_STATE } from '../../lib/sync/types';

describe('applyOccurrenceRemoval', () => {
  beforeEach(() => fakeBrowser.reset());

  it('writes an occurrence tombstone on an existing word node and bumps revision once', async () => {
    await syncMetadataStorage.setValue({
      revision: 5, lastDigest: null, appSettingsUpdatedAt: 0, aiSettingsUpdatedAt: 0,
      state: {
        ...EMPTY_SYNC_STATE,
        words: {
          'word:你好': {
            normalized: '你好', fields: {},
            createdAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } },
            occurrences: { 'occ:abc': { id: 'occ:abc', sourceTitle: '', sourceUrl: 'u', sourceDomain: '', surrounding: 's', capturedAt: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } } },
            occurrenceTombstones: {}, reviewEvents: {},
          },
        },
      },
    });

    await applyOccurrenceRemoval([{ normalized: '你好', occurrenceId: 'occ:abc' }]);

    const meta = await syncMetadataStorage.getValue();
    expect(meta.revision).toBe(6);
    expect(meta.state!.words['word:你好'].occurrenceTombstones['occ:abc']).toBeDefined();
  });

  it('creates a minimal word node when the node is missing', async () => {
    await syncMetadataStorage.setValue({
      revision: 0, lastDigest: null, appSettingsUpdatedAt: 0, aiSettingsUpdatedAt: 0,
      state: { ...EMPTY_SYNC_STATE },
    });
    await applyOccurrenceRemoval([{ normalized: '新词', occurrenceId: 'occ:xyz' }]);
    const meta = await syncMetadataStorage.getValue();
    expect(meta.state!.words['word:新词'].occurrenceTombstones['occ:xyz']).toBeDefined();
    expect(meta.state!.words['word:新词'].normalized).toBe('新词');
  });
});
