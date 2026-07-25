import type { AiMessage } from './prompt';

const SYSTEM_PROMPT = `You translate Chinese sentences into natural English. Given one Chinese sentence, produce a single fluent English rendering that reads as an English sentence, not a word-for-word gloss.

Return valid JSON only, no markdown, in this shape:
{"translation":"Heaven and earth are not kind; they treat all things as straw dogs."}

Do not add pinyin, commentary, alternatives, or explanation. Respond with JSON only.`;

export function buildTranslateMessages(quoteText: string): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Sentence: ${quoteText}` },
  ];
}
