import type {
  CompactDictionaryAsset,
  DictionaryEntry,
  DictionaryIndex,
  DictionarySourceId,
} from './types';

/** A raw parsed entry before it is materialized into the compact asset. */
export interface ParsedCedictEntry {
  traditional: string;
  simplified: string;
  pinyin: string;
  definitions: string[];
}

export interface ParseCedictStats {
  entries: ParsedCedictEntry[];
  skipped: number;
}

const LINE_RE = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.*)\/\s*$/;

/**
 * Parse a single CC-CEDICT line into an entry, or return null for comments,
 * blank lines, and lines that do not match the expected shape.
 */
export function parseCedictLine(line: string): ParsedCedictEntry | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  const match = LINE_RE.exec(trimmed);
  if (!match) return null;
  const [, traditional, simplified, pinyin, defsBody] = match;
  const definitions = defsBody
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (definitions.length === 0) return null;
  return { traditional, simplified, pinyin, definitions };
}

/**
 * Parse an entire CC-CEDICT document. When `withStats` is set, also returns
 * the count of lines that were skipped (comments do not count as skipped).
 */
export function parseCedictText(text: string): ParsedCedictEntry[];
export function parseCedictText(
  text: string,
  options: { withStats: true },
): ParseCedictStats;
export function parseCedictText(
  text: string,
  options: { withStats?: boolean } = {},
): ParsedCedictEntry[] | ParseCedictStats {
  const entries: ParsedCedictEntry[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const parsed = parseCedictLine(line);
    if (parsed) {
      entries.push(parsed);
    } else {
      skipped += 1;
    }
  }
  return options.withStats ? { entries, skipped } : entries;
}

/**
 * Extract the release date from the `#! ... date=YYYY-MM-DD ...` marker line
 * that the CC-CEDICT download places at the top of the file.
 */
export function extractRelease(text: string): string {
  const match = text.match(/^#!.*\bdate=([^\s]+)\b/m);
  return match ? match[1] : 'unknown';
}

// Materialized-entry and index/lookup functions are added in later tasks.
// This export keeps the type relationship explicit for downstream tasks.
export type { DictionaryEntry };

export interface BuildCompactAssetOptions {
  sourceUrl: string;
  license: string;
  licenseUrl: string;
}

/**
 * Build a compact columnar asset from raw CC-CEDICT text. Definitions are
 * stored contiguously and identical definition sequences are deduped. Each entry
 * stores a [start, count] range into the definitions pool.
 */
export function buildCompactAsset(
  text: string,
  options: BuildCompactAssetOptions,
): CompactDictionaryAsset {
  const { entries, skipped } = parseCedictText(text, { withStats: true });
  void skipped;

  const simplified: string[] = [];
  const traditional: string[] = [];
  const pinyin: string[] = [];
  const definitionRanges: Array<[number, number]> = [];
  const definitions: string[] = [];
  const defSequenceIndex = new Map<string, [number, number]>();

  for (const entry of entries) {
    simplified.push(entry.simplified);
    traditional.push(entry.traditional);
    pinyin.push(entry.pinyin);
    const sequenceKey = JSON.stringify(entry.definitions);
    const existingRange = defSequenceIndex.get(sequenceKey);
    if (existingRange) {
      definitionRanges.push(existingRange);
      continue;
    }

    const start = definitions.length;
    definitions.push(...entry.definitions);
    const range: [number, number] = [start, entry.definitions.length];
    defSequenceIndex.set(sequenceKey, range);
    definitionRanges.push(range);
  }

  const meta = {
    source: 'CC-CEDICT' as const,
    sourceUrl: options.sourceUrl,
    release: extractRelease(text),
    license: options.license,
    licenseUrl: options.licenseUrl,
    hash: hashAsset({ simplified, traditional, pinyin, definitionRanges, definitions }),
    generatedAt: new Date().toISOString(),
  };

  return { meta, columns: { simplified, traditional, pinyin, definitionRanges, definitions } };
}

/** Rebuild DictionaryEntry[] from a compact asset (used by the loader). */
export function materializeEntries(asset: CompactDictionaryAsset): DictionaryEntry[] {
  const { columns } = asset;
  return columns.simplified.map((_, index) => {
    const [start, count] = columns.definitionRanges[index];
    const definitions = columns.definitions.slice(start, start + count);
    return {
      index,
      traditional: columns.traditional[index],
      simplified: columns.simplified[index],
      pinyin: columns.pinyin[index],
      definitions,
    };
  });
}

function hashAsset(columns: CompactDictionaryAsset['columns']): string {
  const json = JSON.stringify(columns);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const NO_WHITESPACE = /\s+/g;

function formKey(surface: string): string {
  return surface.replace(NO_WHITESPACE, '').toLowerCase();
}

/** Build a lookup index over a materialized entry list. */
export function buildIndex(entries: DictionaryEntry[]): DictionaryIndex {
  const byForm = new Map<string, DictionaryEntry[]>();
  let maxKeyLength = 0;
  for (const entry of entries) {
    for (const surface of new Set([entry.simplified, entry.traditional])) {
      const key = formKey(surface);
      const list = byForm.get(key);
      if (list) list.push(entry);
      else byForm.set(key, [entry]);
      maxKeyLength = Math.max(maxKeyLength, Array.from(key).length);
    }
  }
  return { byForm, maxKeyLength };
}

export function labelDictionaryIndex(
  index: DictionaryIndex,
  source: DictionarySourceId,
): DictionaryIndex {
  return {
    byForm: new Map(
      Array.from(index.byForm.entries()).map(([key, entries]) => [
        key,
        entries.map((entry) => ({ ...entry, source })),
      ]),
    ),
    maxKeyLength: index.maxKeyLength,
  };
}

export function mergeDictionaryIndexes(
  primary: DictionaryIndex,
  fallback: DictionaryIndex | null,
): DictionaryIndex {
  if (!fallback) return primary;
  const byForm = new Map<string, DictionaryEntry[]>();
  for (const [key, entries] of primary.byForm.entries()) {
    byForm.set(key, [...entries]);
  }
  for (const [key, entries] of fallback.byForm.entries()) {
    byForm.set(key, [...(byForm.get(key) ?? []), ...entries]);
  }
  return {
    byForm,
    maxKeyLength: Math.max(primary.maxKeyLength, fallback.maxKeyLength),
  };
}

/** Return all entries whose simplified or traditional form matches `surface`. */
export function lookupExact(index: DictionaryIndex, surface: string): DictionaryEntry[] {
  return index.byForm.get(formKey(surface)) ?? [];
}

/** Maximum captured-text length (in Chinese characters) to segment. */
export const MAX_COMPONENT_LOOKUP_CHARS = 16;

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

export interface ComponentSegment {
  text: string;
  entry?: DictionaryEntry;
}

/**
 * Segment `text` into components using longest-match, then single-char
 * fallback. Returns `[]` when the text exceeds MAX_COMPONENT_LOOKUP_CHARS
 * Chinese characters (caller should show tone help + links only).
 */
export function segmentComponents(
  index: DictionaryIndex,
  text: string,
): ComponentSegment[] {
  const cjkCount = Array.from(text).filter((ch) => CJK.test(ch)).length;
  if (cjkCount > MAX_COMPONENT_LOOKUP_CHARS) return [];

  const chars = Array.from(text);
  const segments: ComponentSegment[] = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (!CJK.test(ch)) {
      i += 1;
      continue;
    }
    let matched: { end: number; entry: DictionaryEntry } | null = null;
    for (let len = Math.min(index.maxKeyLength, chars.length - i); len >= 1; len -= 1) {
      const slice = chars.slice(i, i + len).join('');
      const hits = lookupExact(index, slice);
      if (hits.length > 0) {
        matched = { end: i + len, entry: hits[0] };
        break;
      }
    }
    if (matched) {
      segments.push({ text: chars.slice(i, matched.end).join(''), entry: matched.entry });
      i = matched.end;
    } else {
      segments.push({ text: ch });
      i += 1;
    }
  }
  return segments;
}
