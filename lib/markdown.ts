import { lookupExact } from './dictionary';
import type { Cloze, DictionaryIndex, QuoteEntry, WordEntry } from './types';

function esc(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function renderQuoteBody(quote: QuoteEntry): string {
  if (!quote.clozes?.length) {
    return esc(quote.text);
  }
  const sorted = [...quote.clozes].sort((a: Cloze, b: Cloze) => a.start - b.start);
  let result = '';
  let cursor = 0;
  for (let i = 0; i < sorted.length; i++) {
    const cloze = sorted[i];
    result += esc(quote.text.slice(cursor, cloze.start));
    result += `{{c${i + 1}::${esc(quote.text.slice(cloze.start, cloze.end))}}}`;
    cursor = cloze.end;
  }
  result += esc(quote.text.slice(cursor));
  return result;
}

function reviewLine(review: WordEntry['review']): string | null {
  if (!review) return null;
  const due = new Date(review.dueAt);
  const dueStr = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  const state = review.cardState ?? 'review';
  return `Review: due ${dueStr}, state ${state}, interval ${review.intervalDays} days`;
}

export function renderDay(
  date: string,
  words: WordEntry[],
  quotes: QuoteEntry[],
  index?: DictionaryIndex | null,
): string {
  const lines: string[] = [];
  lines.push('---', `date: ${date}`, `words: ${words.length}`, `quotes: ${quotes.length}`, '---', '');

  if (words.length > 0) {
    lines.push('## Words', '');
    for (const word of words) {
      const pinyin = word.pinyin ? ` _${word.pinyin}_` : '';
      lines.push(`- [ ] **${esc(word.text)}**${pinyin}`);
      if (word.note) lines.push(`  - ${esc(word.note)}`);
      for (const occurrence of word.occurrences) {
        lines.push(`  - [${esc(occurrence.sourceTitle || occurrence.sourceDomain)}](${occurrence.sourceUrl})`);
      }
      if (index) {
        const entries = dictionaryEntriesForWord(index, word).slice(0, 3);
        for (const entry of entries) {
          lines.push(`  - Dictionary: _${esc(entry.pinyin)}_ ${entry.definitions.map((d) => esc(d)).join('; ')}`);
        }
      }
      if (word.aiInsight) {
        const ai = word.aiInsight;
        lines.push('');
        lines.push('## AI Insight');
        lines.push(`- ${esc(word.text)}`);
        if (ai.summary) lines.push(`  - _${esc(ai.summary)}_ (${esc(ai.register)})`);
        for (const definition of ai.definitions) {
          lines.push(`  - ${esc(definition)}`);
        }
        for (let i = 0; i < ai.sampleSentences.length; i += 1) {
          lines.push(`  - ${esc(ai.sampleSentences[i])}`);
          if (ai.translations[i]) {
            lines.push(`    ${esc(ai.translations[i])}`);
          }
        }
        if (ai.collocations.length > 0) {
          lines.push(`  - 搭配: ${ai.collocations.map((collocation) => esc(collocation)).join(', ')}`);
        }
        if (ai.notes) lines.push(`  - ${esc(ai.notes)}`);
      }
      const rLine = reviewLine(word.review);
      if (rLine) lines.push(`  - ${rLine}`);
      lines.push('');
    }
  }

  if (quotes.length > 0) {
    lines.push('## Quotes', '');
    for (const quote of quotes) {
      const tags = quote.tags.length > 0 ? ` ${quote.tags.map((tag) => `#${tag}`).join(' ')}` : '';
      lines.push(`- [ ] > ${renderQuoteBody(quote)}`);
      lines.push(`  - _category:_ ${esc(quote.category)}${tags}`);
      if (quote.note) lines.push(`  - ${esc(quote.note)}`);
      lines.push(`  - [${esc(quote.sourceTitle || quote.sourceDomain)}](${quote.sourceUrl})`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function groupByDay(capturedAt: number): string {
  const date = new Date(capturedAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dictionaryEntriesForWord(index: DictionaryIndex, word: WordEntry) {
  return uniqueDictionaryEntries([
    ...lookupExact(index, word.text),
    ...lookupExact(index, word.normalized),
  ]);
}

function uniqueDictionaryEntries(entries: ReturnType<typeof lookupExact>) {
  const seen = new Set<number>();
  return entries.filter((entry) => {
    if (seen.has(entry.index)) return false;
    seen.add(entry.index);
    return true;
  });
}
