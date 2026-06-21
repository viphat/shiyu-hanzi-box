import type { DictionaryEntry } from './types';

interface KaikkiSense {
  glosses?: unknown;
  raw_glosses?: unknown;
}

interface KaikkiSound {
  roman?: unknown;
  pinyin?: unknown;
  zh_pron?: unknown;
  'zh-pron'?: unknown;
}

interface KaikkiRecord {
  word?: unknown;
  lang?: unknown;
  lang_code?: unknown;
  senses?: unknown;
  sounds?: unknown;
}

export interface KaikkiParseResult {
  entries: DictionaryEntry[];
  skipped: number;
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

export function parseKaikkiJsonl(jsonl: string): KaikkiParseResult {
  const bySurface = new Map<string, { pinyin: string; definitions: string[] }>();
  let skipped = 0;

  for (const rawLine of jsonl.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let record: KaikkiRecord;
    try {
      record = JSON.parse(line) as KaikkiRecord;
    } catch {
      skipped += 1;
      continue;
    }

    const surface = typeof record.word === 'string' ? record.word.trim() : '';
    if (!isChineseRecord(record) || !CJK.test(surface)) {
      skipped += 1;
      continue;
    }

    const definitions = extractDefinitions(record);
    if (definitions.length === 0) {
      skipped += 1;
      continue;
    }

    const existing = bySurface.get(surface);
    if (existing) {
      existing.definitions = unique([...existing.definitions, ...definitions]);
      if (!existing.pinyin) existing.pinyin = extractPinyin(record);
    } else {
      bySurface.set(surface, {
        pinyin: extractPinyin(record),
        definitions,
      });
    }
  }

  return {
    entries: Array.from(bySurface.entries()).map(([surface, entry], index) => ({
      index,
      traditional: surface,
      simplified: surface,
      pinyin: entry.pinyin,
      definitions: entry.definitions,
    })),
    skipped,
  };
}

function isChineseRecord(record: KaikkiRecord): boolean {
  return record.lang_code === 'zh' || record.lang === 'Chinese';
}

function extractDefinitions(record: KaikkiRecord): string[] {
  if (!Array.isArray(record.senses)) return [];
  const definitions: string[] = [];
  for (const sense of record.senses as KaikkiSense[]) {
    definitions.push(...stringArray(sense.glosses));
    if (!sense.glosses) definitions.push(...stringArray(sense.raw_glosses));
  }
  return unique(definitions.map((def) => def.trim()).filter(Boolean));
}

function extractPinyin(record: KaikkiRecord): string {
  if (!Array.isArray(record.sounds)) return '';
  for (const sound of record.sounds as KaikkiSound[]) {
    for (const value of [sound.pinyin, sound.roman, sound.zh_pron, sound['zh-pron']]) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function isAllowedKaikkiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'kaikki.org';
  } catch {
    return false;
  }
}

export function hashKaikkiEntries(entries: DictionaryEntry[]): string {
  const json = JSON.stringify(entries);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
