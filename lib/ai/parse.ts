import type { AiInsight, AiProvider } from '../types';

export type AiParseError = { ok: false; reason: string };

export type AiParseResult =
  | { ok: true; value: AiInsight }
  | AiParseError;

function hasStringArray(
  value: Record<string, unknown>,
  key: string,
): value is Record<string, string[]> {
  return Array.isArray(value[key]) && value[key].every((item) => typeof item === 'string');
}

function readRequiredString(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' ? value[key] : null;
}

export function parseAiResponse(
  body: string,
  provider: AiProvider,
  model: string,
  baseUrl: string,
): AiParseResult {
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
    },
  };
}
