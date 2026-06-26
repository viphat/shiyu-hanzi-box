// lib/sync/project.ts
import type {
  AiSettings,
  AppSettings,
  Inbox,
  Occurrence,
  QuoteEntry,
  ReviewLogEntry,
  ReviewState,
  WordEntry,
} from '../types';
import type {
  HybridTimestamp,
  OccurrenceNode,
  QuoteNode,
  Register,
  SyncState,
  WordNode,
} from './types';
import { EMPTY_SYNC_STATE } from './types';
import { isSuppressed } from './registers';
import { DEFAULT_SETTINGS } from '../settings';
import { DEFAULT_AI_SETTINGS } from '../ai/settings';

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

export function legacyOccurrenceId(wordId: string, occ: Occurrence): string {
  return `occ:${fnv1a(`${wordId}|${occ.sourceUrl}|${occ.surrounding}|${occ.capturedAt}`)}`;
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
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stamp(wallTime: number, replicaId: string, counter = 0): HybridTimestamp {
  return { wallTime, counter, replicaId };
}

function reg<T>(value: T, s: HybridTimestamp): Register<T> {
  return { value, stamp: s };
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
    const id = legacyOccurrenceId(word.id, occ);
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
      aiInsight: reg(word.aiInsight ?? null, s),
      updatedAt: reg(word.updatedAt, s),
    },
    occurrences,
    occurrenceTombstones: {},
    ...projectScheduler(key, word.review, ctx.replicaId),
  };
}

function projectQuote(quote: QuoteEntry, ctx: BootstrapContext): QuoteNode {
  const s = stamp(quote.updatedAt, ctx.replicaId);
  // Override: call projectScheduler ONCE and destructure both fields (avoids double-computation)
  const { reviewEvents, snapshot } = projectScheduler(`quote:${quote.id}`, quote.review, ctx.replicaId);
  return {
    id: quote.id,
    createdAt: reg(quote.createdAt, stamp(quote.createdAt, ctx.replicaId)),
    fields: {
      text: reg(quote.text, s),
      note: reg(quote.note, s),
      status: reg(quote.status, s),
      category: reg(quote.category, s),
      tags: reg(quote.tags, s),
      sourceTitle: reg(quote.sourceTitle, s),
      sourceUrl: reg(quote.sourceUrl, s),
      sourceDomain: reg(quote.sourceDomain, s),
      surrounding: reg(quote.surrounding, s),
      pinyin: reg(quote.pinyin ?? null, s),
      traditionalText: reg(quote.traditionalText ?? null, s),
      updatedAt: reg(quote.updatedAt, s),
    },
    reviewEvents,
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
): SyncState {
  const s = stamp(ctx.wallTime, ctx.replicaId);
  const state: SyncState = {
    ...EMPTY_SYNC_STATE,
    replicas: [ctx.replicaId],
    words: {},
    quotes: {},
    tombstones: {},
    appSettings: {
      uiLocale: reg(settings.uiLocale, s),
      'srs.desiredRetention': reg(settings.srs.desiredRetention, s),
      'srs.maximumIntervalDays': reg(settings.srs.maximumIntervalDays, s),
      'srs.newCardsPerDay': reg(settings.srs.newCardsPerDay, s),
      'srs.enableFuzz': reg(settings.srs.enableFuzz, s),
    },
    aiSettings: Object.fromEntries(
      AI_FIELDS.map((f) => [f, reg((ai as unknown as Record<string, unknown>)[f], s)]),
    ),
    kaikkiSource: {
      sourceUrl: reg(settings.kaikki.sourceUrl, s),
      sourceName: reg(settings.kaikki.sourceName, s),
    },
  };
  for (const word of inbox.words) state.words[wordKey(word.normalized)] = projectWord(word, ctx);
  for (const quote of inbox.quotes) state.quotes[quote.id] = projectQuote(quote, ctx);
  return state;
}

// ---------------------------------------------------------------------------
// Internal: rebuildReview
// ---------------------------------------------------------------------------

function rebuildReview(node: WordNode | QuoteNode): ReviewState | undefined {
  if (!node.snapshot && Object.keys(node.reviewEvents).length === 0) return undefined;
  const log = Object.values(node.reviewEvents)
    .sort(
      (a, b) =>
        a.reviewedAt - b.reviewedAt ||
        a.eventVersion - b.eventVersion ||
        a.id.localeCompare(b.id),
    )
    .map((e) => e.payload as ReviewLogEntry);
  const base = (node.snapshot?.payload as Partial<ReviewState>) ?? {};
  return { ...(base as ReviewState), reviewLog: log };
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
  for (const [key, node] of Object.entries(state.words)) {
    if (isSuppressed(node.fields.updatedAt?.stamp, state.tombstones[key])) continue;
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
      aiInsight: (node.fields.aiInsight?.value as WordEntry['aiInsight']) ?? undefined,
      occurrences,
      ...(review ? { review } : {}),
    });
  }
  words.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  const quotes: QuoteEntry[] = [];
  for (const [id, node] of Object.entries(state.quotes)) {
    if (isSuppressed(node.fields.updatedAt?.stamp, state.tombstones[`quote:${id}`])) continue;
    const review = rebuildReview(node);
    quotes.push({
      id: node.id,
      kind: 'quote',
      text: node.fields.text?.value as string,
      note: (node.fields.note?.value as string) ?? '',
      status: node.fields.status?.value as QuoteEntry['status'],
      category: (node.fields.category?.value as string) ?? 'uncategorized',
      tags: (node.fields.tags?.value as string[]) ?? [],
      createdAt: node.createdAt.value,
      updatedAt: node.fields.updatedAt?.value as number,
      sourceTitle: (node.fields.sourceTitle?.value as string) ?? '',
      sourceUrl: (node.fields.sourceUrl?.value as string) ?? '',
      sourceDomain: (node.fields.sourceDomain?.value as string) ?? '',
      surrounding: (node.fields.surrounding?.value as string) ?? '',
      pinyin: (node.fields.pinyin?.value as string | null) ?? undefined,
      traditionalText: (node.fields.traditionalText?.value as string | null) ?? undefined,
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
