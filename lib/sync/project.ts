import type {
  AiSettings,
  AppSettings,
  Cloze,
  Inbox,
  Occurrence,
  QuoteEntry,
  QuoteTranslations,
  ReviewLogEntry,
  ReviewState,
  WordEntry,
} from '../types';
import type {
  ClozeNode,
  HybridTimestamp,
  OccurrenceNode,
  ReviewEventNode,
  QuoteNode,
  Register,
  SyncState,
  WordNode,
} from './types';
import { EMPTY_SYNC_STATE } from './types';
import { isSuppressed } from './registers';
import { compareTimestamps } from './clock';
import { DEFAULT_SETTINGS } from '../settings';
import { DEFAULT_AI_SETTINGS } from '../ai/settings';
import { normalizeTags } from '../tags';
import { sanitizeQuoteTranslations } from '../translate/validate';
import { isAiInsight, isVietnameseAiInsight } from '../ai/parse';

// ---------------------------------------------------------------------------
// Public key helpers
// ---------------------------------------------------------------------------

export function wordKey(normalized: string): string {
  return `word:${normalized}`;
}

// ---------------------------------------------------------------------------
// Internal hash helper
// ---------------------------------------------------------------------------

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Legacy bootstrap ID helpers
// ---------------------------------------------------------------------------

/**
 * Stable id for one capture inside its word.
 *
 * Derived from the word's LOGICAL key, never its public `id`: merge picks a
 * canonical word id (earliest createdAt, then smallest id) and materialize
 * writes that id back into the inbox, so keying off `word.id` re-minted a
 * second id for the same capture on whichever profile lost the tie — and the
 * union then showed the user a duplicate occurrence. `normalized` is the
 * dedupe key itself and cannot change under an entry.
 *
 * (The design spec says "owning word ID"; this is a deliberate departure, for
 * the reason above. Nodes authored under the old rule are folded onto these
 * ids by `normalizeOccurrenceIds`.)
 */
export function occurrenceId(normalized: string, occ: Occurrence): string {
  return `occ:${fnv1a(`${wordKey(normalized)}|${occ.sourceUrl}|${occ.surrounding}|${occ.capturedAt}`)}`;
}

export function legacyReviewEventId(entityKey: string, reviewedAt: number, index: number): string {
  return `rev:${fnv1a(`${entityKey}|${reviewedAt}|${index}`)}`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AI_FIELDS = ['enabled', 'provider', 'baseUrl', 'apiKey', 'model'] as const;

export const PORTABLE_APP_FIELDS = [
  'uiLocale',
  'srs.desiredRetention',
  'srs.maximumIntervalDays',
  'srs.newCardsPerDay',
  'srs.enableFuzz',
] as const;

// ---------------------------------------------------------------------------
// Bootstrap context
// ---------------------------------------------------------------------------

export interface BootstrapContext {
  replicaId: string;
  wallTime: number;
  /**
   * Wall-clock ms of the last user edit to app settings (kaikki included).
   * 0 = never edited ("unversioned") — loses to any real vault stamp.
   * Defaults to 0 when omitted.
   */
  settingsStamp?: number;
  /**
   * Wall-clock ms of the last user edit to AI settings.
   * 0 = never edited ("unversioned") — loses to any real vault stamp.
   * Defaults to 0 when omitted.
   */
  aiStamp?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Conflict resolution uses wall-time last-write-wins: every field stamp is
// built from the entity's own domain timestamp (updatedAt / capturedAt /
// reviewedAt) and merged via compareTimestamps (wallTime, then counter, then
// replicaId for a deterministic tiebreak). This is the deliberate, accepted
// model for personal multi-device sync — it always converges. We do NOT wire
// the hybrid logical clock (lib/sync/clock.ts createClock/observe/tick) into
// projection, so a device with a badly skewed system clock can in principle
// win or lose a field conflict regardless of real edit order. The HLC and the
// `clock-skew` SyncErrorCode are intentionally retained for a future
// skew-hardening pass; today's stamps are plain wall time.
function stamp(wallTime: number, replicaId: string, counter = 0): HybridTimestamp {
  return { wallTime, counter, replicaId };
}

function reg<T>(value: T, s: HybridTimestamp): Register<T> {
  return { value, stamp: s };
}

function insightStamp<T extends { generatedAt: number }>(
  value: unknown,
  fallback: number,
  replicaId: string,
  isValid: (candidate: unknown) => candidate is T,
): HybridTimestamp {
  if (isValid(value)) {
    return stamp(value.generatedAt, replicaId);
  }
  return stamp(fallback, replicaId);
}

function projectScheduler(
  entityKey: string,
  review: ReviewState | undefined,
  replicaId: string,
): Pick<WordNode, 'reviewEvents' | 'snapshot'> {
  const reviewEvents: WordNode['reviewEvents'] = {};
  if (!review) return { reviewEvents, snapshot: undefined };
  const log = review.reviewLog ?? [];
  let latestId: string | undefined;
  log.forEach((entry, index) => {
    const id = legacyReviewEventId(entityKey, entry.reviewedAt, index);
    reviewEvents[id] = {
      id,
      reviewedAt: entry.reviewedAt,
      eventVersion: 1,
      payload: entry,
      stamp: stamp(entry.reviewedAt, replicaId),
    };
    latestId = id;
  });
  const { reviewLog: _log, queueRank: _rank, ...snapshotPayload } = review;
  const snapshot = latestId
    ? {
        payload: snapshotPayload,
        reviewEventId: latestId,
        stamp: stamp(review.lastReviewedAt ?? review.dueAt, replicaId),
      }
    : undefined;
  return { reviewEvents, snapshot };
}

function projectWord(word: WordEntry, ctx: BootstrapContext): WordNode {
  const key = wordKey(word.normalized);
  const s = stamp(word.updatedAt, ctx.replicaId);
  const occurrences: Record<string, OccurrenceNode> = {};
  for (const occ of word.occurrences) {
    const id = occurrenceId(word.normalized, occ);
    occurrences[id] = { id, ...occ, stamp: stamp(occ.capturedAt, ctx.replicaId) };
  }
  return {
    normalized: word.normalized,
    createdAt: reg(word.createdAt, stamp(word.createdAt, ctx.replicaId)),
    fields: {
      id: reg(word.id, s),
      text: reg(word.text, s),
      note: reg(word.note, s),
      status: reg(word.status, s),
      pinyin: reg(word.pinyin ?? null, s),
      traditionalText: reg(word.traditionalText ?? null, s),
      ...(word.aiInsight !== undefined
        ? {
            aiInsight: reg(
              word.aiInsight,
              insightStamp(word.aiInsight, word.updatedAt, ctx.replicaId, isAiInsight),
            ),
          }
        : {}),
      ...(word.aiVietnameseInsight !== undefined
        ? {
            aiVietnameseInsight: reg(
              word.aiVietnameseInsight,
              insightStamp(
                word.aiVietnameseInsight,
                word.updatedAt,
                ctx.replicaId,
                isVietnameseAiInsight,
              ),
            ),
          }
        : {}),
      updatedAt: reg(word.updatedAt, s),
    },
    occurrences,
    occurrenceTombstones: {},
    // Reset like every other tombstone map: removals are recorded straight into
    // the persisted state (here, by a backup restore) and the coordinator's
    // merge with that state carries them forward.
    reviewTombstones: {},
    ...projectScheduler(key, word.review, ctx.replicaId),
  };
}

export function clozeKey(quoteId: string, clozeId: string): string {
  return `cloze:${quoteId}:${clozeId}`;
}

/**
 * Project one cloze blank. Mirrors the tag OR-Set for presence (carry-forward
 * add stamp, fresh stamp minted above any prior tombstone on re-add) and the
 * word/quote scheduler projection for its review history — one cloze is one
 * FSRS card, so it owns its review events and snapshot.
 *
 * Field stamps use the owning quote's `updatedAt`: every write path that edits
 * a cloze (dashboard edits, answerReviewCloze, postponeReviewCloze) bumps it,
 * so it is the correct recency key for the span and its presentation.
 */
function projectCloze(
  quoteId: string,
  cloze: Cloze,
  quoteUpdatedAt: number,
  ctx: BootstrapContext,
  prev?: QuoteNode,
): ClozeNode {
  const s = stamp(quoteUpdatedAt, ctx.replicaId);
  const prevNode = prev?.clozes?.[cloze.id];
  const prevTomb = prev?.clozeTombstones?.[cloze.id];
  const stillPresent = prevNode && !isSuppressed(prevNode.addedAt, prevTomb);
  const addedAt = stillPresent
    ? prevNode.addedAt
    : stamp(Math.max(quoteUpdatedAt, (prevTomb?.wallTime ?? 0) + 1), ctx.replicaId);
  return {
    id: cloze.id,
    addedAt,
    fields: {
      start: reg(cloze.start, s),
      end: reg(cloze.end, s),
      // Optional domain fields are stamped as explicit nulls, not omitted: a
      // cleared hint or an unlinked word must beat a peer's older value, and
      // both are cheap scalars owned by the same edit as start/end.
      hint: reg(cloze.hint ?? null, s),
      wordId: reg(cloze.wordId ?? null, s),
    },
    reviewTombstones: {},
    ...projectScheduler(clozeKey(quoteId, cloze.id), cloze.review, ctx.replicaId),
  };
}

function projectQuote(quote: QuoteEntry, ctx: BootstrapContext, prev?: QuoteNode): QuoteNode {
  const s = stamp(quote.updatedAt, ctx.replicaId);
  const { reviewEvents, snapshot } = projectScheduler(`quote:${quote.id}`, quote.review, ctx.replicaId);

  // OR-Set add stamps with carry-forward: an already-present tag keeps its
  // persisted add stamp (so unrelated edits never move it past a tombstone);
  // a new tag or a re-add mints a fresh stamp guaranteed above any prior
  // tombstone (which also closes the same-millisecond re-add race).
  const tags: Record<string, HybridTimestamp> = {};
  for (const tag of normalizeTags(quote.tags)) {
    const prevAdd = prev?.tags?.[tag];
    const prevTomb = prev?.tagTombstones?.[tag];
    const stillPresent = prevAdd && !isSuppressed(prevAdd, prevTomb);
    tags[tag] = stillPresent
      ? prevAdd
      : stamp(Math.max(quote.updatedAt, (prevTomb?.wallTime ?? 0) + 1), ctx.replicaId);
  }

  const clozes: Record<string, ClozeNode> = {};
  for (const cloze of quote.clozes ?? []) {
    clozes[cloze.id] = projectCloze(quote.id, cloze, quote.updatedAt, ctx, prev);
  }

  return {
    id: quote.id,
    createdAt: reg(quote.createdAt, stamp(quote.createdAt, ctx.replicaId)),
    fields: {
      text: reg(quote.text, s),
      note: reg(quote.note, s),
      status: reg(quote.status, s),
      sourceTitle: reg(quote.sourceTitle, s),
      sourceUrl: reg(quote.sourceUrl, s),
      sourceDomain: reg(quote.sourceDomain, s),
      surrounding: reg(quote.surrounding, s),
      pinyin: reg(quote.pinyin ?? null, s),
      traditionalText: reg(quote.traditionalText ?? null, s),
      // One register per slot, not one object register: a Google translate on
      // device A and an AI translate on device B must both survive the merge.
      // Absent slots are omitted rather than stamped null so an untranslated
      // replica cannot overwrite a peer's translation.
      // Consequence: removal is UNREPRESENTABLE. Absence merges as "no
      // opinion", not as "cleared", so a future "clear this translation"
      // affordance would silently self-revert — the coordinator merges the
      // fresh projection (no register) with persisted state (register still
      // present) and writes the old value back, even with zero peers.
      // Clearing a slot would require a tombstone or a cleared-sentinel.
      // Stamped by the slot's own generatedAt, NOT the shared `s`
      // (quote.updatedAt): unlike every sibling field here, a translation is
      // written once and never mutated by an unrelated edit to the quote, so
      // re-stamping it with `s` would let an unrelated later edit (e.g. the
      // note) revert a peer's newer translation on merge. generatedAt is the
      // correct recency key for this sub-object, exactly as `occurrences` are
      // stamped by `occ.capturedAt` and review events by `entry.reviewedAt`
      // rather than by the parent's `updatedAt`.
      ...(quote.translations?.google
        ? {
            translationGoogle: reg(
              quote.translations.google,
              stamp(quote.translations.google.generatedAt, ctx.replicaId),
            ),
          }
        : {}),
      ...(quote.translations?.ai
        ? {
            translationAi: reg(
              quote.translations.ai,
              stamp(quote.translations.ai.generatedAt, ctx.replicaId),
            ),
          }
        : {}),
      updatedAt: reg(quote.updatedAt, s),
    },
    tags,
    tagTombstones: {},
    clozes,
    // Like tagTombstones: removals are recorded by applyClozeRemoval straight
    // into the persisted state, and the coordinator's merge with that state
    // carries them forward. Projection alone never sees a removal.
    clozeTombstones: {},
    reviewEvents,
    reviewTombstones: {},
    snapshot,
  };
}

// ---------------------------------------------------------------------------
// Public: projectInbox
// ---------------------------------------------------------------------------

export function projectInbox(
  inbox: Inbox,
  settings: AppSettings,
  ai: AiSettings,
  ctx: BootstrapContext,
  persisted?: SyncState,
): SyncState {
  // Use the tracked last-edit timestamps for settings/AI so that:
  //   0 ("unversioned", never edited) loses to any real remote stamp, and
  //   a real edit timestamp wins by recency rather than "last-synced".
  // Inbox domain stamps (words/quotes/occurrences/review) always use their
  // own domain timestamps — unchanged.
  const sSettings = stamp(ctx.settingsStamp ?? 0, ctx.replicaId);
  const sAi = stamp(ctx.aiStamp ?? 0, ctx.replicaId);
  const state: SyncState = {
    ...EMPTY_SYNC_STATE,
    replicas: [ctx.replicaId],
    words: {},
    quotes: {},
    tombstones: {},
    appSettings: {
      uiLocale: reg(settings.uiLocale, sSettings),
      'srs.desiredRetention': reg(settings.srs.desiredRetention, sSettings),
      'srs.maximumIntervalDays': reg(settings.srs.maximumIntervalDays, sSettings),
      'srs.newCardsPerDay': reg(settings.srs.newCardsPerDay, sSettings),
      'srs.enableFuzz': reg(settings.srs.enableFuzz, sSettings),
    },
    aiSettings: Object.fromEntries(
      AI_FIELDS.map((f) => [f, reg((ai as unknown as Record<string, unknown>)[f], sAi)]),
    ),
    kaikkiSource: {
      sourceUrl: reg(settings.kaikki.sourceUrl, sSettings),
      sourceName: reg(settings.kaikki.sourceName, sSettings),
    },
  };
  for (const word of inbox.words) state.words[wordKey(word.normalized)] = projectWord(word, ctx);
  for (const quote of inbox.quotes) {
    state.quotes[quote.id] = projectQuote(quote, ctx, persisted?.quotes[quote.id]);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Internal: rebuildReview
// ---------------------------------------------------------------------------

/**
 * Guard: verify that an opaque snapshot payload carries all four required
 * scheduler fields before we spread it into a ReviewState.  A foreign or
 * corrupt payload (null, array, primitive, or an object missing any of the
 * four required numeric fields) must NOT be used — materialising a partial
 * ReviewState would hand downstream SRS logic (lib/srs.ts) an object with
 * undefined scheduler fields, silently corrupting scheduling.  Returning
 * undefined lets the SRS treat the entry as new rather than acting on noise.
 */
function isSchedulerPayload(payload: unknown): payload is ReviewState {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.dueAt === 'number' &&
    typeof p.intervalDays === 'number' &&
    typeof p.repetitions === 'number' &&
    typeof p.lapses === 'number'
  );
}

/**
 * Review events minus the ones a restore discarded. Events are stamped by
 * their own `reviewedAt`, so a tombstone written now suppresses every review
 * that had already happened while leaving any later one untouched.
 */
export function liveReviewEvents(
  node: WordNode | QuoteNode | ClozeNode,
): Record<string, ReviewEventNode> {
  const events = node.reviewEvents ?? {};
  const tombstones = node.reviewTombstones;
  if (!tombstones || Object.keys(tombstones).length === 0) return events;
  const live: Record<string, ReviewEventNode> = {};
  for (const [id, event] of Object.entries(events)) {
    if (!isSuppressed(event.stamp, tombstones[id])) live[id] = event;
  }
  return live;
}

function rebuildReview(node: WordNode | QuoteNode | ClozeNode): ReviewState | undefined {
  const events = liveReviewEvents(node);
  if (!node.snapshot && Object.keys(events).length === 0) return undefined;
  const log = Object.values(events)
    .sort(
      (a, b) =>
        a.reviewedAt - b.reviewedAt ||
        a.eventVersion - b.eventVersion ||
        a.id.localeCompare(b.id),
    )
    .map((e) => e.payload as ReviewLogEntry);
  const payload = node.snapshot?.payload;
  // Drop the review entirely when the snapshot payload is absent or invalid:
  // returning a partial ReviewState (missing dueAt / intervalDays / etc.) is
  // worse than returning undefined, which the caller treats as "no review yet".
  if (!isSchedulerPayload(payload)) return undefined;
  return { ...payload, reviewLog: log };
}

const CLOZE_HINTS: ReadonlyArray<NonNullable<Cloze['hint']>> = ['none', 'pinyin', 'length'];

/**
 * Rebuild the domain `Cloze[]` from a quote node's OR-Set.
 *
 * Registers hold raw peer-supplied values, so the span is structurally
 * validated (finite numbers, non-empty, non-negative) and a cloze that fails
 * is dropped — a NaN span would break slicing in the review UI and Markdown
 * export. Spans are deliberately NOT range-checked against the merged text:
 * concurrent "edit text here / add blank there" would then silently delete a
 * peer's blank, and an over-long span merely renders clamped.
 */
function rebuildClozes(node: QuoteNode): Cloze[] {
  const out: Cloze[] = [];
  for (const [id, cloze] of Object.entries(node.clozes ?? {})) {
    if (isSuppressed(cloze?.addedAt, node.clozeTombstones?.[id])) continue;
    const start = cloze?.fields?.start?.value;
    const end = cloze?.fields?.end?.value;
    if (typeof start !== 'number' || typeof end !== 'number') continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0 || end <= start) continue;
    const hint = cloze.fields.hint?.value;
    const wordId = cloze.fields.wordId?.value;
    const review = rebuildReview(cloze);
    out.push({
      // The map key is authoritative — it is what tombstones are keyed by.
      id,
      start,
      end,
      ...(CLOZE_HINTS.includes(hint as NonNullable<Cloze['hint']>)
        ? { hint: hint as Cloze['hint'] }
        : {}),
      ...(typeof wordId === 'string' && wordId ? { wordId } : {}),
      ...(review ? { review } : {}),
    });
  }
  return out.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Public: liftLegacyTags
// ---------------------------------------------------------------------------

/**
 * Tolerant cross-version read: fold occurrences authored under the old
 * word-id-derived ids onto their canonical ids, rebuilt from each node's own
 * capture tuple. Two nodes for the same capture collapse to one (later stamp
 * wins), so an upgrade converges instead of duplicating.
 *
 * Tombstones are re-keyed through the same map, or a removal recorded under an
 * old id would stop biting and the upgrade would resurrect the occurrence. A
 * tombstone whose node is absent from this state cannot be mapped and is left
 * on its stored id — no worse than before, where ids only ever matched when
 * the replicas agreed on the word id.
 *
 * Safe and cheap to call on already-canonical nodes: it returns the input
 * untouched when every id already matches.
 */
export function normalizeOccurrenceIds(node: WordNode): WordNode {
  const canonical = new Map<string, string>();
  let changed = false;
  for (const [storedId, occ] of Object.entries(node.occurrences ?? {})) {
    const id = occurrenceId(node.normalized, occ);
    canonical.set(storedId, id);
    if (id !== storedId) changed = true;
  }
  if (!changed) return node;

  const occurrences: Record<string, OccurrenceNode> = {};
  for (const [storedId, occ] of Object.entries(node.occurrences)) {
    const id = canonical.get(storedId)!;
    const existing = occurrences[id];
    if (!existing || compareTimestamps(occ.stamp, existing.stamp) > 0) {
      occurrences[id] = { ...occ, id };
    }
  }
  const occurrenceTombstones: Record<string, HybridTimestamp> = {};
  for (const [storedId, tomb] of Object.entries(node.occurrenceTombstones ?? {})) {
    const id = canonical.get(storedId) ?? storedId;
    const existing = occurrenceTombstones[id];
    if (!existing || compareTimestamps(tomb, existing) > 0) occurrenceTombstones[id] = tomb;
  }
  return { ...node, occurrences, occurrenceTombstones };
}

/**
 * Tolerant cross-version read: if a node has no OR-Set `tags` map (authored by
 * an older client) but carries a legacy `fields.tags` register, fold that
 * register's value into the OR-Set, each tag stamped with the register's stamp.
 * Safe to call on already-migrated nodes — it no-ops when `tags` is non-empty.
 * The empty-trigger is safe: a removed tag leaves a suppressed-but-present
 * entry, so a touched node's map is never empty; an empty map alongside a
 * legacy register only occurs for genuinely-old nodes.
 */
export function liftLegacyTags(node: QuoteNode): QuoteNode {
  const hasOrSet = node.tags && Object.keys(node.tags).length > 0;
  if (hasOrSet) return node;
  const legacy = node.fields.tags as Register<unknown> | undefined;
  const legacyValue = legacy?.value;
  if (!Array.isArray(legacyValue) || legacyValue.length === 0) return node;
  const tags: Record<string, HybridTimestamp> = {};
  for (const tag of normalizeTags(legacyValue as string[])) {
    tags[tag] = legacy!.stamp;
  }
  return { ...node, tags };
}

// ---------------------------------------------------------------------------
// Public: materialize
// ---------------------------------------------------------------------------

function pickWordId(node: WordNode): string {
  return (node.fields.id?.value as string) ?? '';
}

export function materialize(state: SyncState): {
  inbox: Inbox;
  portableSettings: { uiLocale: AppSettings['uiLocale']; srs: AppSettings['srs'] };
  ai: AiSettings;
  kaikkiSource: { sourceUrl: string; sourceName: string };
} {
  const words: WordEntry[] = [];
  for (const [key, raw] of Object.entries(state.words)) {
    if (isSuppressed(raw.fields.updatedAt?.stamp, state.tombstones[key])) continue;
    const node = normalizeOccurrenceIds(raw);
    const occurrences: Occurrence[] = Object.values(node.occurrences)
      .filter((o) => !isSuppressed(o.stamp, node.occurrenceTombstones[o.id]))
      .sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id))
      .map(({ id: _id, stamp: _s, ...rest }) => rest as Occurrence);
    const review = rebuildReview(node);
    words.push({
      id: pickWordId(node),
      kind: 'word',
      text: node.fields.text?.value as string,
      normalized: node.normalized,
      note: (node.fields.note?.value as string) ?? '',
      status: node.fields.status?.value as WordEntry['status'],
      createdAt: node.createdAt.value,
      updatedAt: node.fields.updatedAt?.value as number,
      pinyin: (node.fields.pinyin?.value as string | null) ?? undefined,
      traditionalText: (node.fields.traditionalText?.value as string | null) ?? undefined,
      ...(isAiInsight(node.fields.aiInsight?.value)
        ? { aiInsight: node.fields.aiInsight.value }
        : {}),
      ...(isVietnameseAiInsight(node.fields.aiVietnameseInsight?.value)
        ? { aiVietnameseInsight: node.fields.aiVietnameseInsight.value }
        : {}),
      occurrences,
      ...(review ? { review } : {}),
    });
  }
  words.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  const quotes: QuoteEntry[] = [];
  for (const [id, raw] of Object.entries(state.quotes)) {
    if (isSuppressed(raw.fields.updatedAt?.stamp, state.tombstones[`quote:${id}`])) continue;
    const node = liftLegacyTags(raw);
    const review = rebuildReview(node);
    const clozes = rebuildClozes(node);
    const tags = Object.entries(node.tags ?? {})
      .filter(([tag, addStamp]) => !isSuppressed(addStamp, node.tagTombstones?.[tag]))
      .map(([tag]) => tag)
      .sort();
    // Registers hold raw peer-supplied values with no compile-time guarantee
    // they match QuoteTranslation/AiQuoteTranslation — a malformed or hostile
    // replica file can put anything there. Route each through the shared
    // sanitizer (wrapping the lone slot under its key) instead of casting.
    const googleSlot = sanitizeQuoteTranslations({ google: node.fields.translationGoogle?.value })?.google;
    const aiSlot = sanitizeQuoteTranslations({ ai: node.fields.translationAi?.value })?.ai;
    const translations: QuoteTranslations = {
      ...(googleSlot ? { google: googleSlot } : {}),
      ...(aiSlot ? { ai: aiSlot } : {}),
    };
    quotes.push({
      id: node.id,
      kind: 'quote',
      text: node.fields.text?.value as string,
      note: (node.fields.note?.value as string) ?? '',
      status: node.fields.status?.value as QuoteEntry['status'],
      tags,
      createdAt: node.createdAt.value,
      updatedAt: node.fields.updatedAt?.value as number,
      sourceTitle: (node.fields.sourceTitle?.value as string) ?? '',
      sourceUrl: (node.fields.sourceUrl?.value as string) ?? '',
      sourceDomain: (node.fields.sourceDomain?.value as string) ?? '',
      surrounding: (node.fields.surrounding?.value as string) ?? '',
      pinyin: (node.fields.pinyin?.value as string | null) ?? undefined,
      traditionalText: (node.fields.traditionalText?.value as string | null) ?? undefined,
      ...(Object.keys(translations).length > 0 ? { translations } : {}),
      // An empty set is emitted as absent, matching the domain's "absent or []
      // => parked" rule and the style of `translations` / `review` above.
      ...(clozes.length > 0 ? { clozes } : {}),
      ...(review ? { review } : {}),
    });
  }
  quotes.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  const get = (m: Record<string, Register<unknown>>, k: string, dflt: unknown) =>
    m[k] ? m[k].value : dflt;

  return {
    inbox: { words, quotes },
    portableSettings: {
      uiLocale: get(state.appSettings, 'uiLocale', DEFAULT_SETTINGS.uiLocale) as AppSettings['uiLocale'],
      srs: {
        desiredRetention: get(state.appSettings, 'srs.desiredRetention', DEFAULT_SETTINGS.srs.desiredRetention) as number,
        maximumIntervalDays: get(state.appSettings, 'srs.maximumIntervalDays', DEFAULT_SETTINGS.srs.maximumIntervalDays) as number,
        newCardsPerDay: get(state.appSettings, 'srs.newCardsPerDay', DEFAULT_SETTINGS.srs.newCardsPerDay) as number,
        enableFuzz: get(state.appSettings, 'srs.enableFuzz', DEFAULT_SETTINGS.srs.enableFuzz) as boolean,
      },
    },
    ai: {
      enabled: get(state.aiSettings, 'enabled', DEFAULT_AI_SETTINGS.enabled) as boolean,
      provider: get(state.aiSettings, 'provider', DEFAULT_AI_SETTINGS.provider) as AiSettings['provider'],
      baseUrl: get(state.aiSettings, 'baseUrl', DEFAULT_AI_SETTINGS.baseUrl) as string,
      apiKey: get(state.aiSettings, 'apiKey', DEFAULT_AI_SETTINGS.apiKey) as string,
      model: get(state.aiSettings, 'model', DEFAULT_AI_SETTINGS.model) as string,
    },
    kaikkiSource: {
      sourceUrl: get(state.kaikkiSource, 'sourceUrl', DEFAULT_SETTINGS.kaikki.sourceUrl) as string,
      sourceName: get(state.kaikkiSource, 'sourceName', DEFAULT_SETTINGS.kaikki.sourceName) as string,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal export for downstream modules
// ---------------------------------------------------------------------------

export { stamp as bootstrapStamp };
