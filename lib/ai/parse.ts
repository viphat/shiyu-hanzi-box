import type {
  AiInsight,
  AiInsightLanguage,
  AiProvider,
  VietnameseAiInsight,
} from '../types';

export type AiParseError = { ok: false; reason: string };

export type AiInsightForLanguage<Language extends AiInsightLanguage> =
  Language extends 'vi' ? VietnameseAiInsight : AiInsight;

export type AiParseResult<Language extends AiInsightLanguage = AiInsightLanguage> =
  | { ok: true; value: AiInsightForLanguage<Language> }
  | AiParseError;

const AI_PROVIDERS = new Set<AiProvider>([
  'deepseek',
  'openai',
  'openrouter',
  'gemini',
  'qwen',
  'moonshot',
  'zhipu',
]);

function hasStringArray(
  value: Record<string, unknown>,
  key: string,
): value is Record<string, string[]> {
  return Array.isArray(value[key]) && value[key].every((item) => typeof item === 'string');
}

function readRequiredString(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' ? value[key] : null;
}

function isBaseAiInsight(value: unknown): value is AiInsight {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.provider === 'string' &&
    AI_PROVIDERS.has(obj.provider as AiProvider) &&
    typeof obj.model === 'string' &&
    typeof obj.baseUrl === 'string' &&
    typeof obj.generatedAt === 'number' &&
    Number.isFinite(obj.generatedAt) &&
    typeof obj.summary === 'string' &&
    typeof obj.register === 'string' &&
    typeof obj.notes === 'string' &&
    hasStringArray(obj, 'definitions') &&
    hasStringArray(obj, 'sampleSentences') &&
    hasStringArray(obj, 'translations') &&
    hasStringArray(obj, 'collocations') &&
    obj.sampleSentences.length === obj.translations.length
  );
}

export function isAiInsight(value: unknown): value is AiInsight {
  return isBaseAiInsight(value) && !('outputLanguage' in value);
}

export function isVietnameseAiInsight(value: unknown): value is VietnameseAiInsight {
  return (
    isBaseAiInsight(value) &&
    (value as AiInsight & { outputLanguage?: unknown }).outputLanguage === 'vi'
  );
}

export function parseAiResponse<Language extends AiInsightLanguage = 'en'>(
  body: string,
  provider: AiProvider,
  model: string,
  baseUrl: string,
  language: Language = 'en' as Language,
): AiParseResult<Language> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'Response is not valid JSON.' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'Response is not a JSON object.' };
  }

  const obj = parsed as Record<string, unknown>;
  const summary = readRequiredString(obj, 'summary');
  const register = readRequiredString(obj, 'register');
  const notes = readRequiredString(obj, 'notes');
  if (
    summary === null ||
    register === null ||
    notes === null ||
    !hasStringArray(obj, 'definitions') ||
    !hasStringArray(obj, 'sampleSentences') ||
    !hasStringArray(obj, 'translations') ||
    !hasStringArray(obj, 'collocations')
  ) {
    return { ok: false, reason: 'Response schema mismatch.' };
  }

  if (obj.sampleSentences.length !== obj.translations.length) {
    return {
      ok: false,
      reason: 'Response schema mismatch: sampleSentences and translations must be parallel.',
    };
  }

  return {
    ok: true,
    value: {
      provider,
      model,
      baseUrl,
      generatedAt: Date.now(),
      summary,
      register,
      definitions: obj.definitions,
      sampleSentences: obj.sampleSentences,
      translations: obj.translations,
      collocations: obj.collocations,
      notes,
      ...(language === 'vi' ? { outputLanguage: 'vi' as const } : {}),
    } as AiInsightForLanguage<Language>,
  };
}
