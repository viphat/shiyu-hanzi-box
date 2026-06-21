import type { DictionaryEntry } from './types';

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
