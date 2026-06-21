import { lookupExact, segmentComponents } from './dictionary';
import { buildExternalLinks } from './external-dictionaries';
import { displayableOccurrences } from './occurrences';
import { cedictPinyinToChips, inferToneChips } from './pinyin-helpers';
import type {
  DictionaryEntry,
  DictionaryIndex,
  HighlightedExample,
  HighlightRange,
  Occurrence,
  WordEntry,
  WordInsight,
} from './types';

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
  const displayable = displayableOccurrences(occurrences);
  if (displayable.length === 0) return [];
  const needles = uniqueNeedles([word, ...variants]);

  const newestBySurrounding = new Map<string, Occurrence>();
  for (const occ of displayable) {
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
  return removeOverlappingRanges(
    ranges.sort((a, b) => a.start - b.start || b.end - a.end),
  );
}

function uniqueNeedles(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function removeOverlappingRanges(ranges: HighlightRange[]): HighlightRange[] {
  const out: HighlightRange[] = [];
  let coveredUntil = -1;
  for (const range of ranges) {
    if (range.start < coveredUntil) continue;
    out.push(range);
    coveredUntil = range.end;
  }
  return out;
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

const MAX_EXACT_ENTRIES = 5;

/**
 * Combine dictionary lookup, tone analysis, highlighted examples, and
 * external links into a non-persisted WordInsight.
 *
 * Pass `null` for `index` when the dictionary asset could not be loaded.
 */
export function computeWordInsight(
  word: WordEntry,
  index: DictionaryIndex | null,
): WordInsight {
  const displayText = word.text;
  const externalLinks = buildExternalLinks(displayText);

  if (index === null) {
    const examples = buildHighlightedExamples(displayText, word.occurrences);
    return {
      displayText,
      exactEntries: [],
      componentEntries: [],
      toneChips: inferToneChips(displayText),
      examples,
      externalLinks,
      status: 'dictionary-unavailable',
    };
  }

  const exactRaw = uniqueEntries([
    ...lookupExact(index, displayText),
    ...lookupExact(index, word.normalized),
  ]);
  const exactEntries = exactRaw.slice(0, MAX_EXACT_ENTRIES);
  const highlightVariants = exactEntries.flatMap((entry) => [
    entry.simplified,
    entry.traditional,
  ]);
  const examples = buildHighlightedExamples(
    displayText,
    word.occurrences,
    highlightVariants,
  );

  if (exactEntries.length > 0) {
    const primaryPinyin = exactEntries[0].pinyin;
    const toneChips = cedictPinyinToChips(primaryPinyin, displayText);
    return {
      displayText,
      exactEntries,
      componentEntries: [],
      toneChips,
      examples,
      externalLinks,
      status: 'ready',
    };
  }

  const segments = segmentComponents(index, displayText);
  const componentEntries = segments
    .map((seg) => seg.entry)
    .filter((entry): entry is DictionaryEntry => entry !== undefined);

  return {
    displayText,
    exactEntries: [],
    componentEntries,
    toneChips: inferToneChips(displayText),
    examples,
    externalLinks,
    status: 'no-definition',
  };
}

function uniqueEntries(entries: DictionaryEntry[]): DictionaryEntry[] {
  const seen = new Set<number>();
  const out: DictionaryEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.index)) continue;
    seen.add(entry.index);
    out.push(entry);
  }
  return out;
}
