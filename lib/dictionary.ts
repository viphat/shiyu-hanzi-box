import type { CompactDictionaryAsset, DictionaryEntry } from './types';

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
  const match = text.match(/^#!.*\bdate=(\d{4}-\d{2}-\d{2})\b/m);
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
