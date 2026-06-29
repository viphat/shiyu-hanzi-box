import { makeId } from './id';
import { normalizeText } from './normalize';
import { mutateInboxSynced } from './sync/mutations';
import type { Cloze, Occurrence, WordEntry, QuoteEntry } from './types';

export interface SourceInfo {
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
  capturedAt: number;
}

export type WordAction = 'created' | 'occurrence-added' | 'duplicate';
export type QuoteAction = 'created' | 'duplicate';

export interface CaptureOutcome<E, A> {
  /** The resulting (new or existing) entry. */
  entry: E;
  action: A;
  /** For 'occurrence-added': identifies the occurrence to remove on undo. */
  occurrenceCapturedAt?: number;
}

export type TaggedOutcome =
  | { kind: 'word'; entry: WordEntry; action: WordAction; occurrenceCapturedAt?: number }
  | { kind: 'quote'; entry: QuoteEntry; action: QuoteAction };

export const UNDO_CAPTURE_MESSAGE = 'undo-capture' as const;

export interface UndoCaptureMessage {
  type: typeof UNDO_CAPTURE_MESSAGE;
  kind: 'word' | 'quote';
  action: WordAction | QuoteAction;
  /** Word entry id or quote id. */
  entryId: string;
  /** Required for word undo — words are tombstoned by `word:<normalized>`. */
  normalized?: string;
  /** Required for 'occurrence-added' — full tuple to recompute the OR-Set element id. */
  occurrence?: { sourceUrl: string; surrounding: string; capturedAt: number };
}

const DEDUPE_WINDOW_MS = 5000;

export async function saveWord(
  text: string,
  src: SourceInfo,
): Promise<CaptureOutcome<WordEntry, WordAction> | null> {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return null;

  let outcome: CaptureOutcome<WordEntry, WordAction> | null = null;
  await mutateInboxSynced((inbox) => {
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
      outcome = { entry: word, action: 'created' };
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
      outcome = { entry: existing, action: 'duplicate' };
      return inbox;
    }

    const occurrence: Occurrence = { ...src };
    const updated: WordEntry = {
      ...existing,
      occurrences: [...existing.occurrences, occurrence],
      updatedAt: src.capturedAt,
    };
    outcome = { entry: updated, action: 'occurrence-added', occurrenceCapturedAt: src.capturedAt };
    const words = [...inbox.words];
    words[idx] = updated;
    return { ...inbox, words };
  });
  return outcome;
}

export async function saveQuote(
  text: string,
  src: SourceInfo,
): Promise<CaptureOutcome<QuoteEntry, QuoteAction> | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const key = normalizeText(trimmed);

  const now = src.capturedAt;
  let outcome: CaptureOutcome<QuoteEntry, QuoteAction> | null = null;
  await mutateInboxSynced((inbox) => {
    // Scan inside the mutator (on the fresh inbox) to avoid a TOCTOU race.
    const existing = inbox.quotes.find((q) => normalizeText(q.text) === key);
    if (existing) {
      outcome = { entry: existing, action: 'duplicate' };
      return inbox; // untouched — no source merge, no updatedAt bump
    }

    const clozes: Cloze[] = [];
    const quote: QuoteEntry = {
      id: makeId(),
      kind: 'quote',
      text: trimmed,
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
      clozes,
    };
    outcome = { entry: quote, action: 'created' };
    return { ...inbox, quotes: [quote, ...inbox.quotes] };
  });
  return outcome;
}
