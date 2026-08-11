import { clozeKey, legacyReviewEventId, occurrenceId, wordKey } from './project';
import { planClozeWrite } from '../cloze';
import { normalizeTags } from '../tags';
import type { Inbox, ReviewState } from '../types';
import type { ClozeNode, HybridTimestamp, QuoteNode, SyncState, WordNode } from './types';

export interface RestoreRemovals {
  /** removeTags payload: per quote, the tags the restore dropped. */
  tags: Array<{ quoteId: string; tags: string[] }>;
  /** removeClozes payload: per quote, the blanks the restore dropped. */
  clozes: Array<{ quoteId: string; clozeIds: string[] }>;
  /** removeOccurrence payload: one entry per dropped occurrence. */
  occurrences: Array<{ normalized: string; occurrenceId: string }>;
  /** Entity tombstone keys for entries the restore dropped whole. */
  entities: string[];
}

/**
 * Plan the sync side of a backup restore.
 *
 * A restore replaces the whole inbox, but tags, cloze blanks and occurrences
 * are add-wins OR-Sets: a member the backup does not carry is merely ABSENT,
 * and absence is not removal. Without tombstones the next pass materializes
 * every dropped member straight back from persisted state or a peer, and the
 * restore silently fails to stick — while the sync design specifies that a
 * restore is a local synchronized mutation that propagates.
 *
 * Member removals are planned only for entries the restore actually carries,
 * matched on their sync logical key (words by `normalized`, quotes by id). An
 * entry the backup drops whole is an ENTITY deletion instead: it gets a
 * tombstone at its entity key and no member tombstones, which would only make
 * it come back empty if something later restores it.
 */
export function planRestoreRemovals(current: Inbox, restored: Inbox): RestoreRemovals {
  const out: RestoreRemovals = { tags: [], clozes: [], occurrences: [], entities: [] };

  const keptQuotes = new Set(restored.quotes.map((quote) => quote.id));
  for (const quote of current.quotes) {
    if (!keptQuotes.has(quote.id)) out.entities.push(`quote:${quote.id}`);
  }
  const keptWords = new Set(restored.words.map((word) => word.normalized));
  for (const word of current.words) {
    if (!keptWords.has(word.normalized)) out.entities.push(wordKey(word.normalized));
  }

  const quotesBefore = new Map(current.quotes.map((quote) => [quote.id, quote]));
  for (const quote of restored.quotes) {
    const before = quotesBefore.get(quote.id);
    if (!before) continue;
    // Normalize the incoming side: the tombstone keyspace is normalized, so a
    // backup carrying '  A  ' must not read as a removal of 'a'.
    const keptTags = new Set(normalizeTags(quote.tags));
    const tags = before.tags.filter((tag) => !keptTags.has(tag));
    if (tags.length > 0) out.tags.push({ quoteId: quote.id, tags });

    const clozeIds = planClozeWrite(before.clozes, quote.clozes ?? []);
    if (clozeIds.length > 0) out.clozes.push({ quoteId: quote.id, clozeIds });
  }

  const wordsBefore = new Map(current.words.map((word) => [word.normalized, word]));
  for (const word of restored.words) {
    const before = wordsBefore.get(word.normalized);
    if (!before) continue;
    const kept = new Set(word.occurrences.map((occ) => occurrenceId(word.normalized, occ)));
    for (const occ of before.occurrences) {
      const id = occurrenceId(word.normalized, occ);
      if (kept.has(id)) continue;
      out.occurrences.push({ normalized: word.normalized, occurrenceId: id });
    }
  }

  return out;
}

/**
 * Discard the review events an entity holds that the restored copy does not.
 *
 * Review events are unioned by id and were never removable, so a restore could
 * roll an entry's text back but not its reviews: the log — and the scheduler
 * state derived from it — reappeared on the next merge. Events are stamped by
 * their own `reviewedAt`, so a tombstone stamped now discards exactly the
 * reviews that had already happened and cannot touch a later one.
 *
 * Mutates `node` in place, matching how applyRestore builds the rest of the
 * restored state.
 */
function tombstoneStaleReviews(
  node: WordNode | QuoteNode | ClozeNode,
  entityKey: string,
  review: ReviewState | undefined,
  stamp: HybridTimestamp,
): void {
  const kept = new Set<string>();
  (review?.reviewLog ?? []).forEach((entry, index) => {
    kept.add(legacyReviewEventId(entityKey, entry.reviewedAt, index));
  });
  const tombstones = { ...(node.reviewTombstones ?? {}) };
  for (const id of Object.keys(node.reviewEvents ?? {})) {
    if (!kept.has(id)) tombstones[id] = stamp;
  }
  node.reviewTombstones = tombstones;
}

/**
 * Apply `tombstoneStaleReviews` across every entity the restore carries, for
 * words, quotes and each of a quote's cloze blanks (one blank is one card, so
 * each owns its own review log). Entities the restore drops need nothing: the
 * entity or cloze tombstone already suppresses them wholesale.
 */
export function discardStaleReviews(
  state: SyncState,
  restored: Inbox,
  stamp: HybridTimestamp,
): void {
  for (const word of restored.words) {
    const key = wordKey(word.normalized);
    const node = state.words[key];
    if (node) tombstoneStaleReviews(node, key, word.review, stamp);
  }
  for (const quote of restored.quotes) {
    const node = state.quotes[quote.id];
    if (!node) continue;
    tombstoneStaleReviews(node, `quote:${quote.id}`, quote.review, stamp);
    for (const cloze of quote.clozes ?? []) {
      const clozeNode = node.clozes?.[cloze.id];
      if (clozeNode) {
        tombstoneStaleReviews(clozeNode, clozeKey(quote.id, cloze.id), cloze.review, stamp);
      }
    }
  }
}
