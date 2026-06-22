import type { DictionaryEntry, Occurrence, WordEntry } from '../types';

export interface AiMessage {
  role: 'system' | 'user';
  content: string;
}

const SYSTEM_PROMPT = `You are a Chinese-English dictionary assistant. Given a Chinese word, produce a structured JSON object with the following fields:

- "summary": a one-line English gloss
- "register": one of 书面/口语/formal/slang/neutral
- "definitions": an array of 1-3 bilingual definitions (Chinese definition + English gloss), richer than a basic dictionary
- "sampleSentences": an array of 2-3 Chinese example sentences using this word
- "translations": an array of English translations parallel to sampleSentences (same length and order)
- "collocations": an array of 2-4 common collocations or phrases
- "notes": usage notes covering nuance, register, common mistakes, or polyphone guidance

Respond with valid json only. No markdown, no code fences, no commentary.`;

export function buildMessages(
  word: WordEntry,
  pinyin: string | undefined,
  cedictEntries: DictionaryEntry[],
  recentOccurrence: Occurrence | undefined,
): AiMessage[] {
  const parts: string[] = [`Word: ${word.text}`];

  if (pinyin) {
    parts.push(`Pinyin: ${pinyin}`);
  }

  if (cedictEntries.length > 0) {
    const glossLines = cedictEntries.map(
      (entry) => `  [${entry.pinyin}] ${entry.definitions.join('; ')}`,
    );
    parts.push(`CEDICT entries:\n${glossLines.join('\n')}`);
  }

  if (recentOccurrence?.surrounding) {
    parts.push(`Recent context: ${recentOccurrence.surrounding}`);
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}
