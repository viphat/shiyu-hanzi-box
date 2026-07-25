import type { TranslateResult } from '../translate/types';

/**
 * Validate the model's JSON reply into a single English string. Any deviation
 * is `unexpected` — the caller shows a localized retry, never raw model output.
 */
export function parseTranslation(content: string): TranslateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, code: 'unexpected' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'unexpected' };
  }

  const translation = (parsed as Record<string, unknown>).translation;
  if (typeof translation !== 'string' || translation.trim() === '') {
    return { ok: false, code: 'unexpected' };
  }

  return { ok: true, text: translation.trim() };
}
