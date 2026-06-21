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
