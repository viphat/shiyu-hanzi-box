import { compareTimestamps } from './clock';
import { mergeRegisterMap, mergeStampMap } from './registers';
import { liftLegacyTags } from './project';
import type {
  HybridTimestamp,
  OccurrenceNode,
  QuoteNode,
  Register,
  ReviewEventNode,
  SchedulerSnapshotNode,
  SyncState,
  WordNode,
} from './types';

function mergeOccurrences(
  a: Record<string, OccurrenceNode>,
  b: Record<string, OccurrenceNode>,
): Record<string, OccurrenceNode> {
  const out: Record<string, OccurrenceNode> = { ...a };
  for (const [id, node] of Object.entries(b)) {
    const existing = out[id];
    out[id] = !existing || compareTimestamps(node.stamp, existing.stamp) > 0 ? node : existing;
  }
  return out;
}

function mergeReviewEvents(
  a: Record<string, ReviewEventNode>,
  b: Record<string, ReviewEventNode>,
): Record<string, ReviewEventNode> {
  const out: Record<string, ReviewEventNode> = { ...a };
  for (const [id, node] of Object.entries(b)) {
    if (!out[id]) out[id] = node;
  }
  return out;
}

function reviewOrder(a: ReviewEventNode, b: ReviewEventNode): number {
  return (
    a.reviewedAt - b.reviewedAt ||
    a.eventVersion - b.eventVersion ||
    a.id.localeCompare(b.id)
  );
}

function pickSnapshot(
  events: Record<string, ReviewEventNode>,
  a?: SchedulerSnapshotNode,
  b?: SchedulerSnapshotNode,
): SchedulerSnapshotNode | undefined {
  const candidates = [a, b].filter(Boolean) as SchedulerSnapshotNode[];
  if (candidates.length === 0) return undefined;
  // Rule: a snapshot whose reviewEventId is present in the merged events map
  // ("non-orphaned") is always preferred over one whose event is absent
  // ("orphaned" — its event never existed or didn't survive the union).  When
  // both are non-orphaned, reviewOrder decides; final tie-break by stamp.
  // The array is sorted ascending so the LAST element is the winner.
  return candidates.sort((x, y) => {
    const ex = events[x.reviewEventId];
    const ey = events[y.reviewEventId];
    // Non-orphaned > orphaned: sort orphaned first (lower rank) so non-orphaned
    // ends up last and is picked as the winner.
    if (!!ex !== !!ey) return ex ? 1 : -1;
    if (ex && ey) {
      const ord = reviewOrder(ex, ey);
      if (ord !== 0) return ord;
    }
    return compareTimestamps(x.stamp, y.stamp);
  })[candidates.length - 1];
}

function earliestCreatedAt(a: Register<number>, b: Register<number>): Register<number> {
  if (a.value !== b.value) return a.value < b.value ? a : b;
  return compareTimestamps(a.stamp, b.stamp) <= 0 ? a : b;
}

export function mergeWordNodes(a: WordNode, b: WordNode): WordNode {
  const events = mergeReviewEvents(a.reviewEvents, b.reviewEvents);
  const fields = mergeRegisterMap(a.fields, b.fields) as WordNode['fields'];
  const createdAt = earliestCreatedAt(a.createdAt, b.createdAt);
  // Canonical id: earliest createdAt then smallest id.
  const idA = a.fields.id?.value as string;
  const idB = b.fields.id?.value as string;
  const canonicalId =
    a.createdAt.value !== b.createdAt.value
      ? a.createdAt.value < b.createdAt.value
        ? idA
        : idB
      : idA <= idB
        ? idA
        : idB;
  fields.id = { value: canonicalId, stamp: createdAt.stamp };
  return {
    normalized: a.normalized,
    createdAt,
    fields,
    occurrences: mergeOccurrences(a.occurrences, b.occurrences),
    occurrenceTombstones: mergeStampMap(a.occurrenceTombstones, b.occurrenceTombstones),
    reviewEvents: events,
    snapshot: pickSnapshot(events, a.snapshot, b.snapshot),
  };
}

export function mergeQuoteNodes(a: QuoteNode, b: QuoteNode): QuoteNode {
  const la = liftLegacyTags(a);
  const lb = liftLegacyTags(b);
  const events = mergeReviewEvents(la.reviewEvents, lb.reviewEvents);
  return {
    id: la.id,
    createdAt: earliestCreatedAt(la.createdAt, lb.createdAt),
    fields: mergeRegisterMap(la.fields, lb.fields),
    tags: mergeStampMap(la.tags ?? {}, lb.tags ?? {}),
    tagTombstones: mergeStampMap(la.tagTombstones ?? {}, lb.tagTombstones ?? {}),
    reviewEvents: events,
    snapshot: pickSnapshot(events, la.snapshot, lb.snapshot),
  };
}

function mergeNodeMap<T>(
  a: Record<string, T>,
  b: Record<string, T>,
  mergeOne: (x: T, y: T) => T,
): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [key, node] of Object.entries(b)) {
    out[key] = out[key] ? mergeOne(out[key], node) : node;
  }
  return out;
}

export function mergeSyncState(a: SyncState, b: SyncState): SyncState {
  return {
    replicas: Array.from(new Set([...a.replicas, ...b.replicas])).sort(),
    words: mergeNodeMap(a.words, b.words, mergeWordNodes),
    quotes: mergeNodeMap(a.quotes, b.quotes, mergeQuoteNodes),
    tombstones: mergeStampMap(a.tombstones, b.tombstones),
    appSettings: mergeRegisterMap(a.appSettings, b.appSettings),
    aiSettings: mergeRegisterMap(a.aiSettings, b.aiSettings),
    kaikkiSource: mergeRegisterMap(a.kaikkiSource, b.kaikkiSource),
  };
}

export function deleteEntity(
  state: SyncState,
  key: string,
  stamp: HybridTimestamp,
): SyncState {
  return { ...state, tombstones: mergeStampMap(state.tombstones, { [key]: stamp }) };
}
