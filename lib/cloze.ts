import { makeId } from './id';
import type { Cloze, QuoteEntry } from './types';

/** Unicode punctuation test: matches \p{P} */
function isUnicodePunct(ch: string): boolean {
  return /^\p{P}$/u.test(ch);
}

/** Is the char whitespace? */
function isWhitespace(ch: string): boolean {
  return /^\s$/u.test(ch);
}

/** True if the string holds at least one non-whitespace, non-punctuation char. */
function hasMeaningfulChar(text: string): boolean {
  for (const ch of text) {
    if (!isWhitespace(ch) && !isUnicodePunct(ch)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if any two clozes in the array overlap.
 * Useful as an invariant check for later tasks.
 */
export function clozesOverlap(clozes: Cloze[]): boolean {
  const sorted = [...clozes].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return true;
  }
  return false;
}

/**
 * Returns true if the quote is "parked" — i.e., it has no cloze blanks and is
 * not archived. Parked quotes are not review-eligible (spec §5).
 * Archived quotes are excluded because they are intentionally inactive.
 */
export function isParkedQuote(quote: QuoteEntry): boolean {
  if (quote.status === 'archived') return false;
  return !quote.clozes?.length;
}

/**
 * Returns the count of non-archived parked quotes in an array.
 */
export function countParkedQuotes(quotes: QuoteEntry[]): number {
  return quotes.filter(isParkedQuote).length;
}

/**
 * Validate and create a Cloze from a raw [start, end) selection against the
 * given text and existing clozes. Returns null when invalid (empty, out-of-range,
 * or overlapping with any existing cloze).
 *
 * Normalises so start < end regardless of selection direction.
 */
export function clozeFromRange(
  text: string,
  rawStart: number,
  rawEnd: number,
  existing: Cloze[],
): Cloze | null {
  const start = Math.min(rawStart, rawEnd);
  const end = Math.max(rawStart, rawEnd);

  // Empty or out-of-range
  if (start >= end) return null;
  if (start < 0 || end > text.length) return null;

  // Reject selections with no reviewable character (whitespace/punctuation
  // only) — such a blank mirrors a normalized-empty span and can't be answered.
  if (!hasMeaningfulChar(text.slice(start, end))) return null;

  const candidate: Cloze = { id: makeId(), start, end, hint: 'none' };

  // Overlaps with any existing cloze
  if (clozesOverlap([...existing, candidate])) return null;

  return candidate;
}
