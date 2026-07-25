import { parseGtxResponse } from './google-parse';
import type { TranslateResult } from './types';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

/**
 * Google's undocumented keyless translation endpoint. It needs no API key and
 * no account, but it is unsupported: it can rate-limit or change shape without
 * notice, so every deviation becomes a retryable failure code.
 *
 * This module is deliberately permission-unaware — callers request the host
 * permission first (see lib/translate/permissions.ts) so this stays testable
 * with nothing but a mocked fetch.
 */
export async function fetchGoogleTranslation(params: {
  text: string;
}): Promise<TranslateResult> {
  if (params.text.trim() === '') return { ok: false, code: 'empty' };

  const url =
    `${ENDPOINT}?client=gtx&sl=zh-CN&tl=en&dt=t&q=${encodeURIComponent(params.text)}`;

  try {
    const response = await fetch(url);

    if (response.status === 429) return { ok: false, code: 'rate-limited' };
    if (response.status >= 500) return { ok: false, code: 'unreachable' };
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, code: 'unexpected' };
    }

    // Inner guard: a body that fails JSON parsing is `unexpected` (Google sent
    // something we don't understand), distinct from the outer `unreachable`
    // (we never got a response at all).
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, code: 'unexpected' };
    }

    return parseGtxResponse(body);
  } catch {
    return { ok: false, code: 'unreachable' };
  }
}
