import type { HighlightedExample, HighlightRange, Occurrence } from './types';

const SCAN_LIMIT = 1000;

/**
 * Build highlighted source examples from a word's occurrences. Dedupes
 * identical surrounding text (keeping the newest), caps to the newest three,
 * scans at most the first 1000 characters of each surrounding for matches.
 */
export function buildHighlightedExamples(
  word: string,
  occurrences: Occurrence[],
  variants: string[] = [],
): HighlightedExample[] {
  if (occurrences.length === 0) return [];
  const needles = uniqueNeedles([word, ...variants]);

  const newestBySurrounding = new Map<string, Occurrence>();
  for (const occ of occurrences) {
    const prev = newestBySurrounding.get(occ.surrounding);
    if (!prev || occ.capturedAt > prev.capturedAt) {
      newestBySurrounding.set(occ.surrounding, occ);
    }
  }
  const unique = Array.from(newestBySurrounding.values()).sort(
    (a, b) => b.capturedAt - a.capturedAt,
  );
  const top = unique.slice(0, 3);

  return top.map((occ) => {
    const windowed = occ.surrounding.slice(0, SCAN_LIMIT);
    const rawRanges = findRanges(needles, windowed);
    const { snippet, ranges } = clipSnippet(windowed, rawRanges);
    return {
      sourceTitle: occ.sourceTitle,
      sourceUrl: occ.sourceUrl,
      capturedAt: occ.capturedAt,
      snippet,
      ranges,
    };
  });
}

function findRanges(needles: string[], haystack: string): HighlightRange[] {
  if (needles.length === 0 || !haystack) return [];
  const ranges: HighlightRange[] = [];
  for (const needle of needles) {
    let from = 0;
    while (from <= haystack.length) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      ranges.push({ start: idx, end: idx + needle.length, text: needle });
      from = idx + needle.length;
    }
  }
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

function uniqueNeedles(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

const SNIPPET_RADIUS = 64;
const EMPTY_MATCH_SNIPPET = 160;

function clipSnippet(
  text: string,
  ranges: HighlightRange[],
): { snippet: string; ranges: HighlightRange[] } {
  if (text.length === 0) return { snippet: '', ranges: [] };
  if (text.length <= EMPTY_MATCH_SNIPPET) return { snippet: text, ranges };
  if (ranges.length === 0) {
    return { snippet: text.slice(0, EMPTY_MATCH_SNIPPET), ranges: [] };
  }

  const first = ranges[0];
  const start = Math.max(0, first.start - SNIPPET_RADIUS);
  const end = Math.min(text.length, first.end + SNIPPET_RADIUS);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  const snippet = `${prefix}${text.slice(start, end)}${suffix}`;
  const prefixOffset = prefix.length;
  const adjusted = ranges
    .filter((range) => range.start >= start && range.end <= end)
    .map((range) => ({
      ...range,
      start: range.start - start + prefixOffset,
      end: range.end - start + prefixOffset,
    }));
  return { snippet, ranges: adjusted };
}
