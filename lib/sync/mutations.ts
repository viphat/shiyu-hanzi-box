import { storage } from 'wxt/utils/storage';
import { getInbox, setInbox } from '../storage';
import {
  getSettings,
  recordCvdictInstall,
  replaceSettings,
  resetCvdict,
  setCvdictEnabled,
  setReviewMode,
} from '../settings';
import { aiSettingsStorage } from '../ai/settings';
import { ensureReplicaId, mutateSyncConfig } from './local';
import type {
  AiQuoteTranslation,
  CvdictSettings,
  Inbox,
  QuoteTranslation,
  ReviewMode,
  WordAiInsightPatch,
} from '../types';
import { projectInbox, wordKey } from './project';
import { discardStaleReviews, planRestoreRemovals } from './restore';
import { deleteEntity } from './merge';
import { mergeStampMap } from './registers';
import {
  EMPTY_SYNC_STATE,
  type HybridTimestamp,
  type QuoteNode,
  type SyncState,
  type WordNode,
} from './types';
import { normalizeTags } from '../tags';

export interface SyncMetadata {
  revision: number;
  state: SyncState | null;
  lastDigest: string | null;
  /** Wall-clock ms when the user last edited app settings. 0 = never edited (unversioned). */
  appSettingsUpdatedAt: number;
  /** Wall-clock ms when the user last edited AI settings. 0 = never edited (unversioned). */
  aiSettingsUpdatedAt: number;
}

export const syncMetadataStorage = storage.defineItem<SyncMetadata>('local:syncMetadata', {
  fallback: { revision: 0, state: null, lastDigest: null, appSettingsUpdatedAt: 0, aiSettingsUpdatedAt: 0 },
});

export async function readDomainSnapshot() {
  const [inbox, settings, ai] = await Promise.all([
    getInbox(),
    getSettings(),
    aiSettingsStorage.getValue(),
  ]);
  return { inbox, settings, ai };
}

let chain: Promise<unknown> = Promise.resolve();

export async function applyLocalMutation(
  kind: 'inbox' | 'settings' | 'localSettings' | 'ai',
  writer: () => Promise<void>,
): Promise<void> {
  const run = chain.then(async () => {
    await writer();
    const meta = await syncMetadataStorage.getValue();
    const nextRevision = meta.revision + 1;
    const now = Date.now();
    await syncMetadataStorage.setValue({
      ...meta,
      revision: nextRevision,
      state: meta.state,
      appSettingsUpdatedAt: kind === 'settings' ? now : meta.appSettingsUpdatedAt,
      aiSettingsUpdatedAt: kind === 'ai' ? now : meta.aiSettingsUpdatedAt,
    });
    await mutateSyncConfig((cfg) => ({
      ...cfg,
      localRevision: nextRevision,
      // Always mark pending on any local mutation so callers don't need a vaultId
      // to observe the pending flag. This matches what the test specifies: pending
      // must be true after a mutation even when no vaultId is configured.
      pending: true,
      status: cfg.vaultId ? 'pending' : cfg.status,
    }));
  });
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Revision-guarded write: atomically checks that no concurrent local mutation
 * has landed since `expectedRevision` was captured, then runs the writer and
 * bumps the revision exactly like applyLocalMutation.
 *
 * Runs on the same module-level `chain` as applyLocalMutation so it is FIFO
 * w.r.t. other writes — the revision check inside the chained body sees any
 * write that was queued before this call.
 *
 * Returns true if the write was committed; false if the revision had changed
 * (a concurrent write landed — caller should abort and retry).
 */
export async function applyLocalMutationIfUnchanged(
  _kind: 'inbox' | 'settings' | 'ai', // coordinator's merged write — must NOT bump settings timestamps
  expectedRevision: number,
  writer: () => Promise<void>,
): Promise<boolean> {
  let committed = false;
  const run = chain.then(async () => {
    // Use the metadata revision as the canonical source — it is written inside
    // the same mutations chain body (fully awaited) so it is always consistent
    // with any concurrent applyLocalMutation that ran before this slot.
    const meta = await syncMetadataStorage.getValue();
    if (meta.revision !== expectedRevision) {
      // A concurrent local write landed — abort without writing or bumping.
      committed = false;
      return;
    }
    await writer();
    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({ ...meta, revision: nextRevision, state: meta.state });
    await mutateSyncConfig((c) => ({
      ...c,
      localRevision: nextRevision,
      pending: c.vaultId ? true : c.pending,
      status: c.vaultId ? 'pending' : c.status,
    }));
    committed = true;
  });
  chain = run;
  await run;
  return committed;
}

/**
 * Synced read-modify-write for inbox, for background callers (e.g. capture).
 * Runs inside applyLocalMutation's chain so the revision is bumped atomically.
 */
export async function mutateInboxSynced(fn: (inbox: Inbox) => Inbox): Promise<Inbox> {
  let result: Inbox | undefined;
  await applyLocalMutation('inbox', async () => {
    const inbox = await getInbox();
    result = fn(inbox);
    await setInbox(result);
  });
  return result!;
}

export type CvdictSettingsMutation =
  | { operation: 'install'; metadata: Omit<CvdictSettings, 'enabled'> }
  | { operation: 'setEnabled'; enabled: boolean }
  | { operation: 'reset' };

/**
 * Apply a device-local CVDICT settings change in the shared mutation chain.
 *
 * The revision bump protects it from a stale coordinator write, while the
 * localSettings kind deliberately leaves appSettingsUpdatedAt unchanged so
 * this device-only change cannot make stale portable settings win sync.
 */
export async function applyCvdictSettingsMutation(
  mutation: CvdictSettingsMutation,
): Promise<void> {
  await applyLocalMutation('localSettings', async () => {
    const current = await getSettings();
    const next = mutation.operation === 'install'
      ? recordCvdictInstall(current, mutation.metadata)
      : mutation.operation === 'setEnabled'
        ? setCvdictEnabled(current, mutation.enabled)
        : resetCvdict(current);
    await replaceSettings(next);
  });
}

/**
 * Apply a device-local review-mode change in the shared mutation chain.
 *
 * reviewMode is per-device by design (matching the decision to keep CVDICT
 * settings local): it must NOT bump appSettingsUpdatedAt, the LWW stamp for
 * the genuinely synced uiLocale/srs.* registers, or flipping the Drift radio
 * on one device would make that device's copy of those portable settings win
 * the next merge and silently revert a change made elsewhere. Mirrors
 * applyCvdictSettingsMutation exactly.
 */
export async function applyReviewModeMutation(reviewMode: ReviewMode): Promise<void> {
  await applyLocalMutation('localSettings', async () => {
    const current = await getSettings();
    await replaceSettings(setReviewMode(current, reviewMode));
  });
}

export interface QuoteTranslationPatch {
  quoteId: string;
  slot: 'google' | 'ai';
  value: QuoteTranslation | AiQuoteTranslation;
}

/**
 * Atomically merge one translation slot into one quote.
 *
 * Runs inside mutateInboxSynced so the read and the write happen together in
 * the shared chain — a concurrent note/tag/status edit or a background capture
 * can no longer be clobbered by a stale whole-inbox snapshot, and cannot clobber
 * this slot either. The sibling slot is preserved because the spread reads the
 * quote as it exists at apply time, not as the UI saw it.
 */
export async function applyQuoteTranslation(patch: QuoteTranslationPatch): Promise<void> {
  await mutateInboxSynced((inbox) => ({
    ...inbox,
    quotes: inbox.quotes.map((quote) =>
      quote.id === patch.quoteId
        ? {
            ...quote,
            translations: { ...quote.translations, [patch.slot]: patch.value },
            updatedAt: Date.now(),
          }
        : quote,
    ),
  }));
}

/** Atomically write exactly one language-specific AI insight field. */
export async function applyWordAiInsight(patch: WordAiInsightPatch): Promise<void> {
  await mutateInboxSynced((inbox) => {
    if (!inbox.words.some((word) => word.id === patch.wordId)) {
      throw new Error(`Unknown word: ${patch.wordId}`);
    }

    return {
      ...inbox,
      words: inbox.words.map((word) => {
        if (word.id !== patch.wordId) return word;
        return patch.language === 'en'
          ? { ...word, aiInsight: patch.insight, updatedAt: Date.now() }
          : { ...word, aiVietnameseInsight: patch.insight, updatedAt: Date.now() };
      }),
    };
  });
}

export async function applyDeletion(keys: string[]): Promise<void> {
  const run = chain.then(async () => {
    const replicaId = await ensureReplicaId();
    const meta = await syncMetadataStorage.getValue();
    let state: SyncState = meta.state ?? JSON.parse(JSON.stringify(EMPTY_SYNC_STATE)) as SyncState;
    for (const key of keys) {
      state = deleteEntity(state, key, { wallTime: Date.now(), counter: 0, replicaId });
    }
    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({
      revision: nextRevision,
      state,
      lastDigest: meta.lastDigest,
      appSettingsUpdatedAt: meta.appSettingsUpdatedAt,
      aiSettingsUpdatedAt: meta.aiSettingsUpdatedAt,
    });
    await mutateSyncConfig((cfg) => ({
      ...cfg,
      localRevision: nextRevision,
      pending: true,
      status: cfg.vaultId ? 'pending' : cfg.status,
    }));
  });
  chain = run;
  return run;
}

/**
 * A node holding nothing but tombstones, for the case where a removal lands
 * before the entity has ever been projected. It carries no fields, so it loses
 * every register on merge and only contributes its tombstones.
 */
function emptyQuoteNode(id: string, stamp: HybridTimestamp): QuoteNode {
  return {
    id,
    fields: {},
    createdAt: { value: stamp.wallTime, stamp },
    tags: {},
    tagTombstones: {},
    clozes: {},
    clozeTombstones: {},
    reviewEvents: {},
  };
}

function emptyWordNode(normalized: string, stamp: HybridTimestamp): WordNode {
  return {
    normalized,
    fields: {},
    createdAt: { value: stamp.wallTime, stamp },
    occurrences: {},
    occurrenceTombstones: {},
    reviewEvents: {},
  };
}

export async function applyTagRemoval(
  removals: Array<{ quoteId: string; tags: string[] }>,
): Promise<void> {
  const run = chain.then(async () => {
    const replicaId = await ensureReplicaId();
    const meta = await syncMetadataStorage.getValue();
    const state: SyncState = meta.state ?? (JSON.parse(JSON.stringify(EMPTY_SYNC_STATE)) as SyncState);
    const now = Date.now();
    for (const { quoteId, tags } of removals) {
      const node = (state.quotes[quoteId] ??= emptyQuoteNode(quoteId, {
        wallTime: now,
        counter: 0,
        replicaId,
      }));
      if (!node.tagTombstones) node.tagTombstones = {};
      // Normalize so the tombstone keyspace always matches the add-stamp
      // keyspace — a non-normalized key would silently no-op at materialize.
      for (const tag of normalizeTags(tags)) {
        node.tagTombstones[tag] = { wallTime: now, counter: 0, replicaId };
      }
    }
    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({
      revision: nextRevision,
      state,
      lastDigest: meta.lastDigest,
      appSettingsUpdatedAt: meta.appSettingsUpdatedAt,
      aiSettingsUpdatedAt: meta.aiSettingsUpdatedAt,
    });
    await mutateSyncConfig((cfg) => ({
      ...cfg,
      localRevision: nextRevision,
      pending: true,
      status: cfg.vaultId ? 'pending' : cfg.status,
    }));
  });
  chain = run;
  return run;
}

/**
 * Record a tombstone per removed cloze blank.
 *
 * Cloze presence is an add-wins OR-Set, so a blank that merely disappears from
 * the local inbox is resurrected by any replica (or persisted state) that still
 * holds it. Exactly like applyTagRemoval, the removal must be written into the
 * persisted SyncState at edit time — before the inbox write — so it survives a
 * reconcile rebuild and reaches peers on the next pass.
 */
export async function applyClozeRemoval(
  removals: Array<{ quoteId: string; clozeIds: string[] }>,
): Promise<void> {
  const run = chain.then(async () => {
    const replicaId = await ensureReplicaId();
    const meta = await syncMetadataStorage.getValue();
    const state: SyncState = meta.state ?? (JSON.parse(JSON.stringify(EMPTY_SYNC_STATE)) as SyncState);
    const now = Date.now();
    for (const { quoteId, clozeIds } of removals) {
      const node = (state.quotes[quoteId] ??= emptyQuoteNode(quoteId, {
        wallTime: now,
        counter: 0,
        replicaId,
      }));
      if (!node.clozeTombstones) node.clozeTombstones = {};
      for (const clozeId of clozeIds) {
        node.clozeTombstones[clozeId] = { wallTime: now, counter: 0, replicaId };
      }
    }
    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({
      revision: nextRevision,
      state,
      lastDigest: meta.lastDigest,
      appSettingsUpdatedAt: meta.appSettingsUpdatedAt,
      aiSettingsUpdatedAt: meta.aiSettingsUpdatedAt,
    });
    await mutateSyncConfig((cfg) => ({
      ...cfg,
      localRevision: nextRevision,
      pending: true,
      status: cfg.vaultId ? 'pending' : cfg.status,
    }));
  });
  chain = run;
  return run;
}

export async function applyOccurrenceRemoval(
  removals: Array<{ normalized: string; occurrenceId: string }>,
): Promise<void> {
  const run = chain.then(async () => {
    const replicaId = await ensureReplicaId();
    const meta = await syncMetadataStorage.getValue();
    const state: SyncState = meta.state ?? (JSON.parse(JSON.stringify(EMPTY_SYNC_STATE)) as SyncState);
    const now = Date.now();
    for (const { normalized, occurrenceId } of removals) {
      const node = (state.words[wordKey(normalized)] ??= emptyWordNode(normalized, {
        wallTime: now,
        counter: 0,
        replicaId,
      }));
      if (!node.occurrenceTombstones) node.occurrenceTombstones = {};
      node.occurrenceTombstones[occurrenceId] = { wallTime: now, counter: 0, replicaId };
    }
    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({
      revision: nextRevision,
      state,
      lastDigest: meta.lastDigest,
      appSettingsUpdatedAt: meta.appSettingsUpdatedAt,
      aiSettingsUpdatedAt: meta.aiSettingsUpdatedAt,
    });
    await mutateSyncConfig((cfg) => ({
      ...cfg,
      localRevision: nextRevision,
      pending: true,
      status: cfg.vaultId ? 'pending' : cfg.status,
    }));
  });
  chain = run;
  return run;
}

/**
 * Apply a whole-inbox backup restore as ONE synchronized mutation.
 *
 * A restore replaces everything, so it is the only write path that can drop
 * members and entries in bulk. Both directions need handling, or the restore
 * does not stick:
 *
 *  - Dropped tags / blanks / occurrences / entries are only ABSENT from the
 *    incoming inbox, and absence merges as "no opinion" — each needs its
 *    tombstone, or the next pass pulls it back from a peer.
 *  - An entry the backup CARRIES may sit under an entity tombstone from an
 *    earlier deletion. Its own `updatedAt` predates that tombstone, so
 *    materialize would suppress it and the restore would silently fail to
 *    bring it back. The sync design's restoration rule is an intentional
 *    mutation stamped after the tombstone, so those entries — and only those —
 *    are stamped just above it. Every other entry keeps the backup's own
 *    timestamps.
 *
 * Runs inside the shared chain so the tombstones and the inbox write land
 * together under a single revision bump; a split would let the inbox write
 * race ahead of the tombstones it depends on.
 */
export async function applyRestore(next: Inbox): Promise<void> {
  const run = chain.then(async () => {
    const replicaId = await ensureReplicaId();
    const meta = await syncMetadataStorage.getValue();
    let state: SyncState = meta.state ?? (JSON.parse(JSON.stringify(EMPTY_SYNC_STATE)) as SyncState);
    const now = Date.now();
    const at = (wallTime: number) => ({ wallTime, counter: 0, replicaId });

    const removals = planRestoreRemovals(await getInbox(), next);

    for (const key of removals.entities) state = deleteEntity(state, key, at(now));

    for (const { quoteId, tags } of removals.tags) {
      const node = (state.quotes[quoteId] ??= emptyQuoteNode(quoteId, at(now)));
      node.tagTombstones = { ...node.tagTombstones };
      for (const tag of normalizeTags(tags)) node.tagTombstones[tag] = at(now);
    }
    for (const { quoteId, clozeIds } of removals.clozes) {
      const node = (state.quotes[quoteId] ??= emptyQuoteNode(quoteId, at(now)));
      node.clozeTombstones = { ...node.clozeTombstones };
      for (const clozeId of clozeIds) node.clozeTombstones[clozeId] = at(now);
    }
    for (const { normalized, occurrenceId } of removals.occurrences) {
      const node = (state.words[wordKey(normalized)] ??= emptyWordNode(normalized, at(now)));
      node.occurrenceTombstones = { ...node.occurrenceTombstones };
      node.occurrenceTombstones[occurrenceId] = at(now);
    }

    discardStaleReviews(state, next, at(now));

    // Every restored entry is re-stamped as of now. Conflicts resolve by
    // recency, so a backup's own (older) timestamps lose to the very state the
    // user is rolling back — the restored content would be silently reverted on
    // the next merge, and an entity tombstone would swallow the entry outright.
    // Re-stamping is what makes the restore authoritative, and is exactly the
    // design's "a restore receives new local versions and propagates".
    // `updatedAt` is a sync recency key only: nothing in the UI, Markdown
    // export, or scheduler reads it, so this costs nothing user-visible.
    const restoredAt = (key: string) =>
      Math.max(now, (state.tombstones[key]?.wallTime ?? 0) + 1);
    await setInbox({
      words: next.words.map((word) => ({
        ...word,
        updatedAt: restoredAt(wordKey(word.normalized)),
      })),
      quotes: next.quotes.map((quote) => ({
        ...quote,
        updatedAt: restoredAt(`quote:${quote.id}`),
      })),
    });

    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({
      revision: nextRevision,
      state,
      lastDigest: meta.lastDigest,
      appSettingsUpdatedAt: meta.appSettingsUpdatedAt,
      aiSettingsUpdatedAt: meta.aiSettingsUpdatedAt,
    });
    await mutateSyncConfig((cfg) => ({
      ...cfg,
      localRevision: nextRevision,
      pending: true,
      status: cfg.vaultId ? 'pending' : cfg.status,
    }));
  });
  chain = run;
  return run;
}

export async function reconcileOnStartup(): Promise<void> {
  const meta = await syncMetadataStorage.getValue();
  const cfg = await mutateSyncConfig((c) => c);
  if (meta.revision === cfg.localRevision && meta.state) return;
  const replicaId = await ensureReplicaId();
  const { inbox, settings, ai } = await readDomainSnapshot();
  let state = projectInbox(inbox, settings, ai, {
    replicaId,
    wallTime: Date.now(),
    settingsStamp: meta.appSettingsUpdatedAt,
    aiStamp: meta.aiSettingsUpdatedAt,
  });
  // Preserve any tombstones from the existing state so an interrupted write
  // doesn't silently drop deletions that haven't been flushed to a replica yet.
  if (meta.state?.tombstones) {
    state = { ...state, tombstones: mergeStampMap(meta.state.tombstones, state.tombstones) };
  }
  // Per-tag removals live only in each node's `tagTombstones` map (not the
  // top-level `tombstones`), so they need the same carry-forward — otherwise a
  // `removeTags` written just before an interrupted inbox edit is lost on
  // rebuild and a remote replica still holding the tag resurrects it.
  // Per-cloze removals live in `clozeTombstones` and need the same
  // carry-forward for the same reason.
  if (meta.state?.quotes) {
    for (const [id, node] of Object.entries(state.quotes)) {
      const prev = meta.state.quotes[id];
      if (prev?.tagTombstones) {
        node.tagTombstones = mergeStampMap(prev.tagTombstones, node.tagTombstones ?? {});
      }
      if (prev?.clozeTombstones) {
        node.clozeTombstones = mergeStampMap(prev.clozeTombstones, node.clozeTombstones ?? {});
      }
      if (prev?.reviewTombstones) {
        node.reviewTombstones = mergeStampMap(prev.reviewTombstones, node.reviewTombstones ?? {});
      }
      for (const [clozeId, clozeNode] of Object.entries(node.clozes ?? {})) {
        const prevCloze = prev?.clozes?.[clozeId]?.reviewTombstones;
        if (prevCloze) {
          clozeNode.reviewTombstones = mergeStampMap(prevCloze, clozeNode.reviewTombstones ?? {});
        }
      }
    }
  }
  // Per-word occurrence removals live only in each word node's
  // `occurrenceTombstones` map (projection resets it to {}), so they need the
  // same carry-forward as tagTombstones — otherwise a `removeOccurrence`
  // written just before an interrupted inbox edit is lost on rebuild and a
  // remote replica still holding the occurrence resurrects it.
  if (meta.state?.words) {
    for (const [id, node] of Object.entries(state.words)) {
      const prev = meta.state.words[id];
      if (prev?.occurrenceTombstones) {
        node.occurrenceTombstones = mergeStampMap(prev.occurrenceTombstones, node.occurrenceTombstones ?? {});
      }
      if (prev?.reviewTombstones) {
        node.reviewTombstones = mergeStampMap(prev.reviewTombstones, node.reviewTombstones ?? {});
      }
    }
  }
  await syncMetadataStorage.setValue({
    revision: cfg.localRevision,
    state,
    lastDigest: meta.lastDigest,
    appSettingsUpdatedAt: meta.appSettingsUpdatedAt,
    aiSettingsUpdatedAt: meta.aiSettingsUpdatedAt,
  });
  if (cfg.vaultId) {
    await mutateSyncConfig((c) => ({ ...c, pending: true, status: 'pending' }));
  }
}
