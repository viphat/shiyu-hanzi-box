import type { AiMessage } from './prompt';

const SYSTEM_PROMPT = `You help build Chinese fill-in-the-blank (cloze) flashcards. Given one Chinese sentence, choose 1-5 spans most worth testing as cloze deletions — key vocabulary, idioms, or collocations, never function words or punctuation.

Return valid JSON only, no markdown, in this shape:
{"blanks":[{"answer":"刚需","reason":"key vocabulary"}]}

Each "answer" MUST be an exact, verbatim substring of the sentence. "reason" is a short English label. Respond with JSON only.`;

export function buildClozeMessages(quoteText: string): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Sentence: ${quoteText}` },
  ];
}
