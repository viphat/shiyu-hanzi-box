import { makeId } from './id';
import { normalizeText } from './normalize';
import { mutateInbox } from './storage';
import type { Occurrence, WordEntry, QuoteEntry } from './types';

export interface SourceInfo {
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
  capturedAt: number;
}

const DEDUPE_WINDOW_MS = 5000;

export async function saveWord(text: string, src: SourceInfo): Promise<WordEntry | null> {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return null;

  let result: WordEntry | null = null;
  await mutateInbox((inbox) => {
    const idx = inbox.words.findIndex((w) => w.normalized === normalized);
    if (idx === -1) {
      const now = src.capturedAt;
      const word: WordEntry = {
        id: makeId(),
        kind: 'word',
        text: text.trim(),
        normalized,
        note: '',
        status: 'inbox',
        createdAt: now,
        updatedAt: now,
        occurrences: [{ ...src }],
        pinyin: undefined,
      };
      result = word;
      return { ...inbox, words: [word, ...inbox.words] };
    }

    const existing = inbox.words[idx];
    const isDuplicateOccurrence = existing.occurrences.some(
      (o) =>
        o.sourceUrl === src.sourceUrl &&
        o.surrounding === src.surrounding &&
        Math.abs(o.capturedAt - src.capturedAt) < DEDUPE_WINDOW_MS,
    );
    if (isDuplicateOccurrence) {
      result = existing;
      return inbox;
    }

    const occurrence: Occurrence = { ...src };
    const updated: WordEntry = {
      ...existing,
      occurrences: [...existing.occurrences, occurrence],
      updatedAt: src.capturedAt,
    };
    result = updated;
    const words = [...inbox.words];
    words[idx] = updated;
    return { ...inbox, words };
  });
  return result;
}

export async function saveQuote(text: string, src: SourceInfo): Promise<QuoteEntry | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const now = src.capturedAt;
  const quote: QuoteEntry = {
    id: makeId(),
    kind: 'quote',
    text: trimmed,
    category: 'uncategorized',
    tags: [],
    note: '',
    status: 'inbox',
    createdAt: now,
    updatedAt: now,
    sourceTitle: src.sourceTitle,
    sourceUrl: src.sourceUrl,
    sourceDomain: src.sourceDomain,
    surrounding: src.surrounding,
    pinyin: undefined,
  };
  await mutateInbox((inbox) => ({ ...inbox, quotes: [quote, ...inbox.quotes] }));
  return quote;
}
