import type {
  AiInsightLanguage,
  DictionaryEntry,
  Occurrence,
  WordEntry,
} from '../types';

export interface AiMessage {
  role: 'system' | 'user';
  content: string;
}

const EN_SYSTEM_PROMPT = `You are a Chinese-English dictionary assistant. Given a Chinese word, produce a structured JSON object with the following fields:

- "summary": a one-line English gloss
- "register": one of 书面/口语/formal/slang/neutral
- "definitions": an array of 1-3 bilingual definitions (Chinese definition + English gloss), richer than a basic dictionary
- "sampleSentences": an array of 2-3 Chinese example sentences using this word
- "translations": an array of English translations parallel to sampleSentences (same length and order)
- "collocations": an array of 2-4 common collocations or phrases
- "notes": usage notes covering nuance, register, common mistakes, or polyphone guidance

Example JSON output:
{
  "summary": "to travel; movement",
  "register": "neutral",
  "definitions": ["出行 - to go out or travel"],
  "sampleSentences": ["周末出行的人很多。", "这条路线方便出行。"],
  "translations": ["Many people travel on weekends.", "This route is convenient for getting around."],
  "collocations": ["出行方式", "绿色出行"],
  "notes": "Use for trips or everyday movement; tone is neutral."
}

Respond with valid json only. No markdown, no code fences, no commentary.`;

const VI_SYSTEM_PROMPT = `You are a Chinese-Vietnamese dictionary assistant. Given a Chinese word, produce a structured JSON object with the following fields:

- "summary": a natural one-line Vietnamese gloss
- "register": one of 书面/口语/formal/slang/neutral
- "definitions": an array of 1-3 natural Vietnamese definitions, richer than a basic dictionary
- "sampleSentences": an array of 2-3 Chinese example sentences using this word
- "translations": an array of natural Vietnamese translations parallel to sampleSentences (same length and order)
- "collocations": an array of 2-4 common Chinese collocations or phrases
- "notes": Vietnamese usage notes covering nuance, register, common mistakes, or polyphone guidance

Example JSON output:
{
  "summary": "đi lại; chuyển động",
  "register": "neutral",
  "definitions": ["ra ngoài hoặc di chuyển từ nơi này đến nơi khác"],
  "sampleSentences": ["周末出行的人很多。", "这条路线方便出行。"],
  "translations": ["Cuối tuần có rất nhiều người đi lại.", "Tuyến đường này thuận tiện cho việc di chuyển."],
  "collocations": ["出行方式", "绿色出行"],
  "notes": "Từ trung tính, dùng cho chuyến đi hoặc việc di chuyển hằng ngày."
}

Respond with valid json only. No markdown, no code fences, no commentary.`;

export interface BuildWordInsightMessagesParams {
  word: WordEntry;
  language: AiInsightLanguage;
  pinyin: string | undefined;
  englishEntries: DictionaryEntry[];
  vietnameseEntries: DictionaryEntry[];
  recentOccurrence: Occurrence | undefined;
}

export function buildWordInsightMessages({
  word,
  language,
  pinyin,
  englishEntries,
  vietnameseEntries,
  recentOccurrence,
}: BuildWordInsightMessagesParams): AiMessage[] {
  const parts: string[] = [`Word: ${word.text}`];

  if (pinyin) {
    parts.push(`Pinyin: ${pinyin}`);
  }

  const dictionaryEntries = language === 'vi' ? vietnameseEntries : englishEntries;
  if (dictionaryEntries.length > 0) {
    const glossLines = dictionaryEntries.map(
      (entry) => `  [${entry.pinyin}] ${entry.definitions.join('; ')}`,
    );
    parts.push(`${language === 'vi' ? 'CVDICT' : 'CEDICT'} entries:\n${glossLines.join('\n')}`);
  }

  if (recentOccurrence?.surrounding) {
    parts.push(`Recent context: ${recentOccurrence.surrounding}`);
  }

  return [
    { role: 'system', content: language === 'vi' ? VI_SYSTEM_PROMPT : EN_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}
