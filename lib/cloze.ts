import { makeId } from './id';
import type { Cloze, WordEntry } from './types';

// ---------------------------------------------------------------------------
// Internal: normalizeWithMap
// Mirror the exact transforms of normalizeText() from lib/normalize.ts
// character-by-character, recording for each surviving normalized char
// the index of its originating raw char.
// ---------------------------------------------------------------------------

interface NormalizedView {
  normalized: string;
  /** map[i] = index in original raw string that produced normalized[i] */
  map: number[];
}

const FULLWIDTH_OFFSET = 0xfee0;

/** Exactly mirrors toHalfWidth() from normalize.ts */
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

/** Unicode punctuation test: matches \p{P} */
function isUnicodePunct(ch: string): boolean {
  return /^\p{P}$/u.test(ch);
}

/** Is the char whitespace? */
function isWhitespace(ch: string): boolean {
  return /^\s$/u.test(ch);
}

/**
 * Normalize the raw text character-by-character, producing a NormalizedView.
 * Mirrors normalizeText() from lib/normalize.ts exactly:
 *   1. toHalfWidth() each char
 *   2. Drop whitespace chars (equivalent to replace(/\s+/g, ''))
 *   3. Lowercase each surviving char
 *   4. Iteratively strip leading/trailing [\s\p{P}]+ until stable
 *      (at step 4, after steps 2–3, there is no whitespace left so only
 *       \p{P} remains possible at edges — but we check both for correctness)
 */
function normalizeWithMap(text: string): NormalizedView {
  // Step 1+2+3: toHalfWidth, drop whitespace, lowercase, record raw indices
  const chars: string[] = [];
  const indices: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const hw = toHalfWidth(text[i]);
    if (isWhitespace(hw)) continue; // drop whitespace
    const lc = hw.toLowerCase();
    chars.push(lc);
    indices.push(i);
  }

  // Step 4: Iteratively strip leading/trailing [\s\p{P}]+ until stable.
  // After step 2, there is no whitespace left, so we only strip \p{P} at edges.
  // We operate on the chars/indices arrays directly.
  let changed = true;
  while (changed) {
    changed = false;
    // Strip leading punct/space
    while (chars.length > 0 && (isWhitespace(chars[0]) || isUnicodePunct(chars[0]))) {
      chars.shift();
      indices.shift();
      changed = true;
    }
    // Strip trailing punct/space
    while (chars.length > 0 && (isWhitespace(chars[chars.length - 1]) || isUnicodePunct(chars[chars.length - 1]))) {
      chars.pop();
      indices.pop();
      changed = true;
    }
  }

  return {
    normalized: chars.join(''),
    map: indices,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find all saved words that appear in the raw text (via normalized matching),
 * project matches back to raw character offsets, greedily select the
 * longest non-overlapping set (left-to-right tiebreak), and return sorted by start.
 */
export function suggestClozes(text: string, savedWords: WordEntry[]): Cloze[] {
  const view = normalizeWithMap(text);
  const { normalized, map } = view;

  // Collect all candidate raw ranges [start, end)
  interface Candidate {
    start: number;
    end: number;
    wordId: string;
  }

  const candidates: Candidate[] = [];

  for (const word of savedWords) {
    const needle = word.normalized;
    if (!needle) continue;

    // Search for all occurrences of needle in normalized
    let pos = 0;
    while (pos <= normalized.length - needle.length) {
      const idx = normalized.indexOf(needle, pos);
      if (idx === -1) break;

      // Project [idx, idx+needle.length) back to raw indices
      const normStart = idx;
      const normEnd = idx + needle.length - 1; // last char index

      const rawStart = map[normStart];
      const rawEnd = map[normEnd] + 1; // exclusive

      candidates.push({ start: rawStart, end: rawEnd, wordId: word.id });
      pos = idx + 1;
    }
  }

  // Sort by length descending, then start ascending for determinism
  candidates.sort((a, b) => {
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenB !== lenA) return lenB - lenA;
    return a.start - b.start;
  });

  // Greedily accept non-overlapping ranges
  const accepted: Candidate[] = [];

  for (const c of candidates) {
    const overlaps = accepted.some(a => c.start < a.end && c.end > a.start);
    if (!overlaps) {
      accepted.push(c);
    }
  }

  // Sort accepted ranges by start
  accepted.sort((a, b) => a.start - b.start);

  // Build Cloze objects
  return accepted.map(c => ({
    id: makeId(),
    start: c.start,
    end: c.end,
    hint: 'none' as const,
    wordId: c.wordId,
  }));
}

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
