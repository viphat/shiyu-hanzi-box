export type Status = 'inbox' | 'reviewed' | 'archived';

export type ReviewScheduler = 'fixed-v1' | 'fsrs-v1';
export type ReviewCardState = 'new' | 'learning' | 'review' | 'relearning';
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewLogEntry {
  reviewedAt: number;
  rating: ReviewRating;
  elapsedDays: number;
  scheduledDays: number;
  stateBefore: ReviewCardState;
  stateAfter: ReviewCardState;
  stabilityBefore?: number;
  stabilityAfter?: number;
  difficultyBefore?: number;
  difficultyAfter?: number;
}

export interface ReviewState {
  scheduler?: ReviewScheduler;
  dueAt: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt?: number;
  queueRank?: number;

  cardState?: ReviewCardState;
  stability?: number;
  difficulty?: number;
  elapsedDays?: number;
  scheduledDays?: number;
  /** Current ts-fsrs (re)learning step index. Must round-trip across sessions. */
  learningSteps?: number;
  retrievability?: number;
  reviewLog?: ReviewLogEntry[];
}

/** A blanked span in a quote. One cloze = one FSRS card. */
export interface Cloze {
  id: string;          // makeId(); stable for the life of the span
  start: number;       // inclusive char index into the Simplified Quote.text
  end: number;         // exclusive
  hint?: 'none' | 'pinyin' | 'length'; // blank presentation; default 'none'
  wordId?: string;     // set when accepted from a saved word
  review?: ReviewState; // per-cloze FSRS state; absent => new
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
  /** Cached Simplified to Traditional (Taiwan) form, generated on demand. */
  traditionalText?: string;
  review?: ReviewState;
}

export interface WordEntry extends EntryBase {
  kind: 'word';
  /** Dedupe key: normalize(text). Stored to avoid recomputation. */
  normalized: string;
  occurrences: Occurrence[];
  /** Opt-in AI-generated insight, persisted after explicit user request. */
  aiInsight?: AiInsight;
}

export interface QuoteEntry extends EntryBase {
  kind: 'quote';
  category: string; // freeform; defaults to 'uncategorized'
  tags: string[];
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
  clozes?: Cloze[];    // absent or [] => parked (not review-eligible)
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

export interface SrsSettings {
  desiredRetention: number;
  maximumIntervalDays: number;
  newCardsPerDay: number;
  enableFuzz: boolean;
}

export interface AppSettings {
  uiLocale: UiLocale;
  kaikki: KaikkiSettings;
  srs: SrsSettings;
}

// ---------------------------------------------------------------------------
// AI settings
// ---------------------------------------------------------------------------

export type AiProvider = 'deepseek' | 'openai' | 'custom';

/** Persisted AI settings, stored locally only. */
export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Persisted AI insight on a word entry. */
export interface AiInsight {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  generatedAt: number;
  summary: string;
  register: string;
  definitions: string[];
  sampleSentences: string[];
  translations: string[];
  collocations: string[];
  notes: string;
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
  /** Additional runtime lookup forms, e.g. Kaikki simplified aliases. */
  variants?: string[];
  /** Runtime-only source label. Cached/generated assets do not need this field. */
  source?: DictionarySourceId;
}

/** Runtime lookup index materialized from the compact asset. Never persisted in chrome.storage. */
export interface DictionaryIndex {
  /** key = normalized simplified/traditional/variant form; value = matching entries in dictionary order. */
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
