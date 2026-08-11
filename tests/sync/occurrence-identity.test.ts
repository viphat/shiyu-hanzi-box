// An occurrence's sync identity must survive a change of its word's public id.
//
// mergeWordNodes picks a canonical word id (earliest createdAt, then smallest
// id) and materialize writes it into the inbox, so the profile whose id lost
// re-projects every occurrence under a different owner. When ids were derived
// from the mutable `word.id`, that re-minted a second node for the same capture
// and the union showed the user a duplicate. Identity is now derived from the
// word's LOGICAL key (`word:<normalized>`), which never changes.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { runSyncPass } from '../../lib/sync/coordinator';
import { deriveKey, defaultKdfParams } from '../../lib/sync/crypto';
import {
  materialize,
  normalizeOccurrenceIds,
  occurrenceId,
  projectInbox,
  wordKey,
} from '../../lib/sync/project';
import { mergeSyncState } from '../../lib/sync/merge';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import { getInbox, setInbox } from '../../lib/storage';
import { EMPTY_SYNC_STATE } from '../../lib/sync/types';
import type { Occurrence, WordEntry } from '../../lib/types';
import type { SyncState, WordNode } from '../../lib/sync/types';

const REPLICA_ID = '01J0AZ5K2YJ3M4N5P6Q7R8S9TW';

const occ = (capturedAt: number): Occurrence => ({
  sourceTitle: 't',
  sourceUrl: 'https://example.com',
  sourceDomain: 'example.com',
  surrounding: 's',
  capturedAt,
});

function word(id: string, occurrences: Occurrence[]): WordEntry {
  return {
    id,
    kind: 'word',
    text: '你好',
    normalized: '你好',
    note: '',
    status: 'inbox',
    createdAt: 10,
    updatedAt: 20,
    occurrences,
  };
}

const project = (id: string, occurrences: Occurrence[], replicaId = 'A') =>
  projectInbox({ words: [word(id, occurrences)], quotes: [] }, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, {
    replicaId,
    wallTime: 1000,
  });

describe('occurrence identity', () => {
  it('does not depend on the word id', () => {
    expect(occurrenceId('你好', occ(500))).toBe(occurrenceId('你好', occ(500)));
    const a = project('zzz-later', [occ(500)]);
    const b = project('aaa-first', [occ(500)]);
    expect(Object.keys(a.words[wordKey('你好')].occurrences)).toEqual(
      Object.keys(b.words[wordKey('你好')].occurrences),
    );
  });

  it('still separates the same capture under different words', () => {
    expect(occurrenceId('你好', occ(500))).not.toBe(occurrenceId('再见', occ(500)));
  });

  it('does not duplicate the capture when two replicas disagree on the word id', () => {
    const merged = mergeSyncState(project('zzz-later', [occ(500)], 'A'), project('aaa-first', [occ(500)], 'B'));
    expect(materialize(merged).inbox.words[0].occurrences).toHaveLength(1);
  });
});

describe('legacy word-id-keyed occurrences', () => {
  // A node authored by an older client: same capture, id derived from word.id.
  function legacyNode(): WordNode {
    const stamp = { wallTime: 5, counter: 0, replicaId: 'OLD' };
    return {
      normalized: '你好',
      fields: { updatedAt: { value: 20, stamp } },
      createdAt: { value: 10, stamp },
      occurrences: {
        'occ:legacy-id': { id: 'occ:legacy-id', ...occ(500), stamp },
      },
      occurrenceTombstones: {},
      reviewEvents: {},
    };
  }

  function stateOf(node: WordNode): SyncState {
    return { ...EMPTY_SYNC_STATE, words: { [wordKey('你好')]: node } };
  }

  it('re-keys a legacy node onto the canonical id', () => {
    const out = normalizeOccurrenceIds(legacyNode());
    expect(Object.keys(out.occurrences)).toEqual([occurrenceId('你好', occ(500))]);
    expect(out.occurrences[occurrenceId('你好', occ(500))].id).toBe(occurrenceId('你好', occ(500)));
  });

  it('folds a legacy node into a current one instead of duplicating it', () => {
    const merged = mergeSyncState(stateOf(legacyNode()), project('w1', [occ(500)]));
    expect(materialize(merged).inbox.words[0].occurrences).toHaveLength(1);
  });

  it('carries a tombstone recorded under the legacy id onto the canonical id', () => {
    const node = legacyNode();
    node.occurrenceTombstones = { 'occ:legacy-id': { wallTime: 900, counter: 0, replicaId: 'OLD' } };
    const merged = mergeSyncState(stateOf(node), project('w1', [occ(500)]));
    // The removal must still bite after the re-key, or the upgrade resurrects it.
    expect(materialize(merged).inbox.words[0].occurrences).toEqual([]);
  });
});

describe('end to end', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
  });

  it('keeps one occurrence across the pass that rewrites the canonical word id', async () => {
    const key = await deriveKey('pw', defaultKdfParams());
    const d = { fs: new MemoryFs(), key, vaultId: 'V1', replicaId: REPLICA_ID, now: () => 1000 };

    await setInbox({ words: [word('zzz-later', [occ(500)])], quotes: [] });
    await runSyncPass(d);
    // A merge hands this profile a different canonical word id; the next pass
    // re-projects the same capture under it.
    await setInbox({ words: [word('aaa-first', [occ(500)])], quotes: [] });
    await runSyncPass(d);
    await runSyncPass(d);

    expect((await getInbox()).words[0].occurrences).toHaveLength(1);
  });
});
