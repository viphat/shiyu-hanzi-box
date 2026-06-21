export type Status = 'inbox' | 'reviewed' | 'archived';

export interface ReviewState {
  dueAt: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt?: number;
  queueRank?: number;
}

/** Captured once per save. Words aggregate many of these. */
export interface Occurrence {
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
  capturedAt: number; // epoch ms
}

/** Base fields shared by words and quotes. */
interface EntryBase {
  id: string;
  text: string;
  note: string;
  status: Status;
  createdAt: number;
  updatedAt: number;
  pinyin?: string;
  review?: ReviewState;
}

export interface WordEntry extends EntryBase {
  kind: 'word';
  /** Dedupe key: normalize(text). Stored to avoid recomputation. */
  normalized: string;
  occurrences: Occurrence[];
}

export interface QuoteEntry extends EntryBase {
  kind: 'quote';
  category: string; // freeform; defaults to 'uncategorized'
  tags: string[];
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
}

export type Entry = WordEntry | QuoteEntry;

/** Shape persisted in chrome.storage.local. */
export interface Inbox {
  words: WordEntry[];
  quotes: QuoteEntry[];
}

export const EMPTY_INBOX: Inbox = { words: [], quotes: [] };

// ---------------------------------------------------------------------------
// App settings
// ---------------------------------------------------------------------------

export type UiLocale = 'en' | 'zh-CN';

export interface KaikkiSettings {
  enabled: boolean;
  sourceUrl: string;
  sourceName: string;
  hash: string | null;
  entryCount: number;
  importedAt: number | null;
}

export interface AppSettings {
  uiLocale: UiLocale;
  kaikki: KaikkiSettings;
}

// ---------------------------------------------------------------------------
// Word Insight domain types (non-persisted — computed at view time)
// ---------------------------------------------------------------------------

/** Metadata for a generated dictionary asset file. */
export interface DictionaryAssetMeta {
  source: 'CC-CEDICT';
  sourceUrl: string;
  release: string;
  license: string;
  licenseUrl: string;
  hash: string;
  generatedAt: string;
}

/** Compact columnar dictionary asset, as emitted by the build script. */
export interface CompactDictionaryAsset {
  meta: DictionaryAssetMeta;
  columns: {
    simplified: string[];
    traditional: string[];
    pinyin: string[];
    /** [startIndex, count] into the contiguous definitions[] pool, per entry. */
    definitionRanges: Array<[number, number]>;
    definitions: string[];
  };
}

export type DictionarySourceId = 'cc-cedict' | 'kaikki';

/** One dictionary entry, after the loader materializes it from a compact/runtime asset. */
export interface DictionaryEntry {
  index: number;
  traditional: string;
  simplified: string;
  pinyin: string;
  definitions: string[];
  /** Runtime-only source label. Cached/generated assets do not need this field. */
  source?: DictionarySourceId;
}

/** Runtime lookup index materialized from the compact asset. Never persisted in chrome.storage. */
export interface DictionaryIndex {
  /** key = normalized simplified/traditional form; value = matching entries in dictionary order. */
  byForm: Map<string, DictionaryEntry[]>;
  /** Longest normalized dictionary key length, used by component segmentation. */
  maxKeyLength: number;
}

/** One syllable's tone info for the tone-chip display. */
export interface ToneChip {
  text: string;
  mark: string;
  numbered: string;
  tone: 0 | 1 | 2 | 3 | 4;
  source: 'dictionary' | 'pinyin-pro';
}

/** A highlighted range inside a source-example snippet. */
export interface HighlightRange {
  start: number;
  end: number;
  text: string;
}

/** A source occurrence rendered as a highlighted example. */
export interface HighlightedExample {
  sourceTitle: string;
  sourceUrl: string;
  capturedAt: number;
  snippet: string;
  ranges: HighlightRange[];
}

/** A click-only outbound dictionary link (no content fetched). */
export interface ExternalDictionaryLink {
  label: 'Youdao' | '百度汉语';
  language: 'Chinese-English' | 'Chinese-Chinese';
  url: string;
}

/** Result of computing insight for a word. Never persisted. */
export interface WordInsight {
  displayText: string;
  exactEntries: DictionaryEntry[];
  componentEntries: DictionaryEntry[];
  toneChips: ToneChip[];
  examples: HighlightedExample[];
  externalLinks: ExternalDictionaryLink[];
  status: 'ready' | 'no-definition' | 'dictionary-unavailable';
}
