import { occurrenceId, wordKey } from './project';
import { planClozeWrite } from '../cloze';
import { normalizeTags } from '../tags';
import type { Inbox } from '../types';

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
