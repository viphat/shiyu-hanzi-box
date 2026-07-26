import { lookupExact } from './dictionary';
import type { AiInsight, Cloze, DictionaryIndex, QuoteEntry, WordEntry } from './types';

function esc(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRenderableAiInsight(value: unknown): value is AiInsight {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const insight = value as Record<string, unknown>;
  return (
    typeof insight.summary === 'string' &&
    typeof insight.register === 'string' &&
    typeof insight.notes === 'string' &&
    isStringArray(insight.definitions) &&
    isStringArray(insight.sampleSentences) &&
    isStringArray(insight.translations) &&
    isStringArray(insight.collocations) &&
    insight.sampleSentences.length === insight.translations.length
  );
}

function renderAiInsights(
  lines: string[],
  entries: Array<{ word: WordEntry; insight: AiInsight }>,
  heading: string,
): void {
  if (entries.length === 0) return;
  lines.push('');
  lines.push(heading);
  for (const { word, insight } of entries) {
    lines.push(`- ${esc(word.text)}`);
    if (insight.summary) lines.push(`  - _${esc(insight.summary)}_ (${esc(insight.register)})`);
    for (const definition of insight.definitions) {
      lines.push(`  - ${esc(definition)}`);
    }
    for (let i = 0; i < insight.sampleSentences.length; i += 1) {
      lines.push(`  - ${esc(insight.sampleSentences[i])}`);
      if (insight.translations[i]) {
        lines.push(`    ${esc(insight.translations[i])}`);
      }
    }
    if (insight.collocations.length > 0) {
      lines.push(`  - 搭配: ${insight.collocations.map((collocation) => esc(collocation)).join(', ')}`);
    }
    if (insight.notes) lines.push(`  - ${esc(insight.notes)}`);
  }
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
    const englishInsights: Array<{ word: WordEntry; insight: AiInsight }> = [];
    const vietnameseInsights: Array<{ word: WordEntry; insight: AiInsight }> = [];
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
      if (isRenderableAiInsight(word.aiInsight)) {
        englishInsights.push({ word, insight: word.aiInsight });
      }
      if (isRenderableAiInsight(word.aiVietnameseInsight)) {
        vietnameseInsights.push({ word, insight: word.aiVietnameseInsight });
      }
      const rLine = reviewLine(word.review);
      if (rLine) lines.push(`  - ${rLine}`);
      lines.push('');
    }
    renderAiInsights(lines, englishInsights, '## AI English Insight');
    renderAiInsights(lines, vietnameseInsights, '## AI Vietnamese Insight');
  }

  if (quotes.length > 0) {
    lines.push('## Quotes', '');
    for (const quote of quotes) {
      const tags = quote.tags.length > 0 ? `  - ${quote.tags.map((tag) => `#${tag}`).join(' ')}` : null;
      lines.push(`- [ ] > ${renderQuoteBody(quote)}`);
      if (tags) lines.push(tags);
      if (quote.note) lines.push(`  - ${esc(quote.note)}`);
      // Translations are a read-only annotation: export never triggers a call.
      // Collapse whitespace before escaping: a newline in the translation
      // would break out of this nested bullet and could inject a spurious
      // list item or heading into the exported note.
      const google = quote.translations?.google?.text;
      if (typeof google === 'string' && google) lines.push(`  - EN (Google): ${esc(oneLine(google))}`);
      const ai = quote.translations?.ai?.text;
      if (typeof ai === 'string' && ai) lines.push(`  - EN (AI): ${esc(oneLine(ai))}`);
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
