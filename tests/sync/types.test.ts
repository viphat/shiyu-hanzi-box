import { describe, expect, it } from 'vitest';
import {
  APP_ID,
  SYNC_FORMAT_VERSION,
  VAULT_FORMAT_VERSION,
  type HybridTimestamp,
  type Register,
  type SyncReplica,
  type SyncState,
} from '../../lib/sync/types';

describe('sync types', () => {
  it('exposes stable app and version constants', () => {
    expect(APP_ID).toBe('shiyu-hanzi-box');
    expect(SYNC_FORMAT_VERSION).toBe(1);
    expect(VAULT_FORMAT_VERSION).toBe(1);
  });

  it('models a replica envelope that wraps sync state', () => {
    const stamp: HybridTimestamp = { wallTime: 1, counter: 0, replicaId: 'R1' };
    const state: SyncState = {
      replicas: ['R1'],
      words: {},
      quotes: {},
      tombstones: {},
      appSettings: {},
      aiSettings: {},
      kaikkiSource: {},
    };
    const replica: SyncReplica = {
      app: APP_ID,
      formatVersion: 1,
      vaultId: 'V1',
      replicaId: 'R1',
      writtenAt: stamp,
      state,
    };
    const reg: Register<string> = { value: 'hi', stamp };
    expect(replica.state.replicas).toEqual(['R1']);
    expect(reg.value).toBe('hi');
  });
});
