import { makeId } from './id';
import type { Cloze, QuoteEntry, WordEntry } from './types';

/**
 * Returns true when a quote has no cloze spans (absent or empty array).
 * Archived parked quotes are intentionally silent; callers decide whether to
 * filter on status.
 */
export function isParkedQuote(quote: QuoteEntry): boolean {
  return !quote.clozes?.length;
}

/**
 * Returns true iff [a.start, a.end) and [b.start, b.end) intersect.
 */
export function clozesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && a.end > b.start;
}

/**
 * Drop invalid spans (start<0, end>textLength, start>=end), sort by start,
 * then drop any span that overlaps an already-kept span (keep the earlier one).
 * Returns a valid, sorted, non-overlapping array.
 */
export function normalizeClozes(clozes: Cloze[], textLength: number): Cloze[] {
  const valid = clozes.filter(
    (c) => c.start >= 0 && c.end <= textLength && c.start < c.end,
  );
  valid.sort((a, b) => a.start - b.start);

  const kept: Cloze[] = [];
  for (const c of valid) {
    const overlaps = kept.some((k) => clozesOverlap(k, c));
    if (!overlaps) {
      kept.push(c);
    }
  }
  return kept;
}

interface NormalizedView {
  normalized: string;
  map: number[]; // map[i] = raw index in source text of normalized char i
}

const FULLWIDTH_OFFSET = 0xfee0;

function toHalfWidth(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code === 0x3000) return ' '; // ideographic space -> regular space
  const half = code - FULLWIDTH_OFFSET;
  if (
    (half >= 0x30 && half <= 0x39) || // 0-9
    (half >= 0x41 && half <= 0x5a) || // A-Z
    (half >= 0x61 && half <= 0x7a)    // a-z
  ) {
    return String.fromCharCode(half);
  }
  return ch;
}

// Edge punctuation pattern (mirrors normalizeText)
const EDGE_PUNCT_START = /^[\s\p{P}]+/u;
const EDGE_PUNCT_END = /[\s\p{P}]+$/u;

/**
 * Mirror normalizeText's transform pipeline, recording the source raw index
 * of each surviving normalized character.
 *
 * Pipeline:
 *   1. toHalfWidth per char (1:1)
 *   2. Remove all whitespace (drop chars)
 *   3. toLowerCase (1:1)
 *   4. Strip leading/trailing edge punctuation until stable (drop chars)
 */
function normalizeWithMap(text: string): NormalizedView {
  // Step 1 & 2: toHalfWidth and remove whitespace, tracking source indices
  const chars: string[] = [];
  const indices: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = toHalfWidth(text[i]);
    // Step 2: skip whitespace
    if (/\s/.test(ch)) continue;
    chars.push(ch);
    indices.push(i);
  }

  // Step 3: toLowerCase (1:1 per char)
  const lowered = chars.map(c => c.toLowerCase());

  // Step 4: Strip leading/trailing edge punctuation until stable
  let str = lowered.join('');
  let map = indices.slice();

  let changed = true;
  while (changed) {
    changed = false;

    // Strip leading edge punctuation
    const leadMatch = str.match(EDGE_PUNCT_START);
    if (leadMatch && leadMatch[0].length > 0) {
      const stripLen = leadMatch[0].length;
      str = str.slice(stripLen);
      map = map.slice(stripLen);
      changed = true;
    }

    // Strip trailing edge punctuation
    const trailMatch = str.match(EDGE_PUNCT_END);
    if (trailMatch && trailMatch[0].length > 0) {
      const stripLen = trailMatch[0].length;
      str = str.slice(0, str.length - stripLen);
      map = map.slice(0, map.length - stripLen);
      changed = true;
    }
  }

  return { normalized: str, map };
}

export function suggestClozes(text: string, savedWords: WordEntry[]): Cloze[] {
  const view = normalizeWithMap(text);
  const { normalized, map } = view;

  // Collect all candidate raw ranges [start, end) for every word's normalized form
  interface Candidate {
    start: number;
    end: number;
    wordId: string;
    length: number; // end - start (raw length)
  }

  const candidates: Candidate[] = [];

  for (const word of savedWords) {
    const needle = word.normalized;
    if (!needle) continue;

    // Find all occurrences of needle in normalized text
    let pos = 0;
    while (pos <= normalized.length - needle.length) {
      const idx = normalized.indexOf(needle, pos);
      if (idx === -1) break;

      // Project normalized range [idx, idx+needle.length) back to raw indices
      const normStart = idx;
      const normEnd = idx + needle.length - 1; // inclusive last char in normalized
      const rawStart = map[normStart];
      const rawEnd = map[normEnd] + 1; // exclusive

      candidates.push({
        start: rawStart,
        end: rawEnd,
        wordId: word.id,
        length: rawEnd - rawStart,
      });

      pos = idx + 1;
    }
  }

  // Sort by length desc (longest first), then by start position for ties
  candidates.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return a.start - b.start;
  });

  // Greedy accept non-overlapping ranges
  const accepted: Cloze[] = [];

  for (const cand of candidates) {
    // Check if this candidate overlaps any already-accepted range
    const overlaps = accepted.some(
      acc => cand.start < acc.end && cand.end > acc.start
    );
    if (!overlaps) {
      accepted.push({
        id: makeId(),
        start: cand.start,
        end: cand.end,
        hint: 'none',
        wordId: cand.wordId,
      });
    }
  }

  // Return sorted by start position
  accepted.sort((a, b) => a.start - b.start);

  return accepted;
}
