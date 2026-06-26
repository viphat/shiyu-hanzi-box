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

// ---------------------------------------------------------------------------
// Brace-markup parser and seeder
// ---------------------------------------------------------------------------

export type ClozeMarkupResult =
  | { ok: true; text: string; clozes: Cloze[] }
  | { ok: false; reason: 'unbalanced' | 'empty-span' | 'overlap' | 'nested' };

/**
 * Parse brace-delimited cloze markup. `{答案}` wraps the answer span; the
 * returned `text` is the markup with braces stripped, and each cloze's
 * [start, end) indexes into that clean text. Use `\{` / `\}` for literal braces.
 */
export function parseClozeMarkup(markup: string): ClozeMarkupResult {
  let text = '';
  const clozes: Cloze[] = [];
  let spanStart: number | null = null;
  let i = 0;

  while (i < markup.length) {
    const ch = markup[i];

    if (ch === '\\' && (markup[i + 1] === '{' || markup[i + 1] === '}')) {
      text += markup[i + 1];
      i += 2;
      continue;
    }
    if (ch === '{') {
      if (spanStart !== null) return { ok: false, reason: 'nested' };
      spanStart = text.length;
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (spanStart === null) return { ok: false, reason: 'unbalanced' };
      if (text.length === spanStart) return { ok: false, reason: 'empty-span' };
      clozes.push({ id: makeId(), start: spanStart, end: text.length });
      spanStart = null;
      i += 1;
      continue;
    }
    text += ch;
    i += 1;
  }

  if (spanStart !== null) return { ok: false, reason: 'unbalanced' };
  // Pairs are disjoint by construction, but guard anyway per the spec.
  if (clozesOverlap(clozes)) return { ok: false, reason: 'overlap' };

  return { ok: true, text, clozes };
}

function escapeBraces(text: string): string {
  return text.replace(/[{}]/g, (ch) => `\\${ch}`);
}

/**
 * Render `text` with `clozes` re-expressed as brace markup, so the manual
 * editor can seed an editable, round-trippable copy. Literal braces in the
 * text are escaped.
 */
export function seedMarkup(text: string, clozes: Cloze[]): string {
  const sorted = [...clozes].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const c of sorted) {
    out += escapeBraces(text.slice(pos, c.start));
    out += `{${escapeBraces(text.slice(c.start, c.end))}}`;
    pos = c.end;
  }
  out += escapeBraces(text.slice(pos));
  return out;
}
