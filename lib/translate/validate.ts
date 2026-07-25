import type { AiQuoteTranslation, QuoteTranslation, QuoteTranslations } from '../types';

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isGeneratedAt(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeGoogleSlot(value: unknown): QuoteTranslation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const slot = value as Record<string, unknown>;
  if (!isText(slot.text) || !isGeneratedAt(slot.generatedAt)) return undefined;
  return { text: slot.text, generatedAt: slot.generatedAt as number };
}

function sanitizeAiSlot(value: unknown): AiQuoteTranslation | undefined {
  const base = sanitizeGoogleSlot(value);
  if (!base) return undefined;
  const slot = value as Record<string, unknown>;
  // provider/model/baseUrl are required on AiQuoteTranslation; a slot missing
  // them is not a valid AI translation, so drop it rather than materialize a
  // half-typed object.
  if (
    typeof slot.provider !== 'string' ||
    typeof slot.model !== 'string' ||
    typeof slot.baseUrl !== 'string'
  ) {
    return undefined;
  }
  return {
    ...base,
    provider: slot.provider as AiQuoteTranslation['provider'],
    model: slot.model,
    baseUrl: slot.baseUrl,
  };
}

/**
 * Validate translations arriving from an untrusted boundary — a hand-edited
 * backup file or a peer replica. Invalid slots are dropped rather than repaired,
 * and an object with no surviving slot returns undefined so the field is omitted
 * entirely (matching how an untranslated quote is stored).
 *
 * Only the fields the type declares are copied through, so unknown extra keys
 * from a foreign replica cannot ride along into storage.
 */
export function sanitizeQuoteTranslations(value: unknown): QuoteTranslations | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const google = sanitizeGoogleSlot(record.google);
  const ai = sanitizeAiSlot(record.ai);
  if (!google && !ai) return undefined;
  return { ...(google ? { google } : {}), ...(ai ? { ai } : {}) };
}
