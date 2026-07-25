import type { TranslateResult } from './types';

/**
 * Parse the undocumented `translate_a/single?client=gtx` response.
 *
 * Shape (only element [0] matters to us):
 *   [ [ ["<english>", "<chinese>", null, null, n], ... ], null, "zh-CN", ... ]
 *
 * Element [0] holds one entry per sentence segment, so a multi-sentence quote
 * arrives split and MUST be rejoined in order. Google does not document this
 * endpoint and can change it, so every deviation returns a failure code rather
 * than throwing.
 */
export function parseGtxResponse(json: unknown): TranslateResult {
  if (!Array.isArray(json)) return { ok: false, code: 'unexpected' };

  const segments = json[0];
  if (!Array.isArray(segments)) return { ok: false, code: 'unexpected' };

  let text = '';
  for (const segment of segments) {
    if (!Array.isArray(segment)) continue;
    const head = segment[0];
    if (typeof head !== 'string') continue;
    text += head;
  }

  if (text.trim() === '') return { ok: false, code: 'empty' };
  return { ok: true, text };
}
