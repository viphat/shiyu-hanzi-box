import type { QuoteEntry } from './types';

/** Trim, collapse internal whitespace to a single space, lowercase. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Normalize each tag, drop empties, dedupe preserving first-seen order. */
export function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Normalize and append `raw` if not already present. Returns a new array. */
export function addTag(tags: string[], raw: string): string[] {
  const tag = normalizeTag(raw);
  if (tag === '' || tags.includes(tag)) return [...tags];
  return [...tags, tag];
}

/** Normalize and remove `raw`. Returns a new array. */
export function removeTag(tags: string[], raw: string): string[] {
  const tag = normalizeTag(raw);
  return tags.filter((t) => t !== tag);
}

/** Frequency map of normalized tags across the given quotes. */
export function tagCounts(quotes: QuoteEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const quote of quotes) {
    for (const tag of quote.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Plan a tag write: normalize the requested next set and compute which of the
 * old tags were removed (so the caller can fire a `removeTags` mutation).
 */
export function planTagWrite(
  old: string[],
  nextRaw: string[],
): { next: string[]; removed: string[] } {
  const next = normalizeTags(nextRaw);
  const removed = old.filter((t) => !next.includes(t));
  return { next, removed };
}

/**
 * Plan a bulk tag removal across many quotes: for every quote that contains
 * `target` (already normalized by the caller), produce a `{ quoteId, tags:
 * [target] }` removal entry. Pure — reads the quotes synchronously so callers
 * can build the batched `removeTags` payload before any async persistence.
 */
export function planTagRemovalAcrossQuotes(
  quotes: Array<{ id: string; tags: string[] }>,
  target: string,
): Array<{ quoteId: string; tags: string[] }> {
  const removals: Array<{ quoteId: string; tags: string[] }> = [];
  for (const quote of quotes) {
    if (quote.tags.includes(target)) {
      removals.push({ quoteId: quote.id, tags: [target] });
    }
  }
  return removals;
}

/** OR semantics: a quote matches if it has any selected tag (empty set = all). */
export function quoteMatchesTags(quote: QuoteEntry, selectedTags: Set<string>): boolean {
  if (selectedTags.size === 0) return true;
  return quote.tags.some((tag) => selectedTags.has(tag));
}

/**
 * Fold a quote's freeform `category` into `tags` and drop the `category` field.
 * Idempotent; tolerates quotes that already lack `category`. The default
 * `uncategorized` contributes no tag.
 */
export function migrateQuoteCategoryToTags<
  T extends { category?: string; tags?: string[] },
>(quote: T): Omit<T, 'category'> & { tags: string[] } {
  const { category, ...rest } = quote;
  let tags = rest.tags ?? [];
  if (category && normalizeTag(category) !== 'uncategorized') {
    tags = addTag(tags, category);
  }
  return { ...(rest as Omit<T, 'category'>), tags: normalizeTags(tags) };
}
