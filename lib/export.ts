import { zip } from 'fflate';
import { groupByDay, renderDay } from './markdown';
import type { DictionaryIndex, Inbox, QuoteEntry, WordEntry } from './types';

interface DayBucket {
  words: WordEntry[];
  quotes: QuoteEntry[];
}

export function buildExportMap(
  words: WordEntry[],
  quotes: QuoteEntry[],
  index?: DictionaryIndex | null,
): Map<string, string> {
  const buckets = new Map<string, DayBucket>();

  function touch(date: string): DayBucket {
    const existing = buckets.get(date);
    if (existing) return existing;

    const bucket = { words: [], quotes: [] };
    buckets.set(date, bucket);
    return bucket;
  }

  for (const word of words) {
    if (word.status === 'archived') continue;
    const date = groupByDay(word.occurrences[0]?.capturedAt ?? word.createdAt);
    touch(date).words.push(word);
  }

  for (const quote of quotes) {
    if (quote.status === 'archived') continue;
    const date = groupByDay(quote.createdAt);
    touch(date).quotes.push(quote);
  }

  const files = new Map<string, string>();
  for (const [date, bucket] of buckets) {
    files.set(`daily/${date}.md`, renderDay(date, bucket.words, bucket.quotes, index));
  }
  return files;
}

export async function zipBytes(files: Map<string, string>): Promise<Uint8Array> {
  const zipInput: Record<string, Uint8Array> = {};
  for (const [path, content] of files) {
    zipInput[path] = new TextEncoder().encode(content);
  }

  return new Promise((resolve, reject) => {
    zip(zipInput, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

export async function exportInboxAsZip(
  inbox: Inbox,
  index?: DictionaryIndex | null,
): Promise<Uint8Array> {
  return zipBytes(buildExportMap(inbox.words, inbox.quotes, index));
}
