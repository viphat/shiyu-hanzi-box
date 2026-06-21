import type { QuoteEntry, WordEntry } from './types';

function esc(value: string): string {
  return value.replace(/\|/g, '\\|');
}

export function renderDay(date: string, words: WordEntry[], quotes: QuoteEntry[]): string {
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
      lines.push('');
    }
  }

  if (quotes.length > 0) {
    lines.push('## Quotes', '');
    for (const quote of quotes) {
      const tags = quote.tags.length > 0 ? ` ${quote.tags.map((tag) => `#${tag}`).join(' ')}` : '';
      lines.push(`- [ ] > ${esc(quote.text)}`);
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
