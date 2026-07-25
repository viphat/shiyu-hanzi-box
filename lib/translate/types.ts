/**
 * Why a translation request failed. A code rather than prose so the UI can
 * localize it — see the `translate.err*` keys in lib/i18n.ts.
 */
export type TranslateFailure =
  | 'rate-limited'
  | 'unreachable'
  | 'unexpected'
  | 'permission-denied'
  | 'empty'
  | 'not-configured';

/**
 * Shared result shape for both the Google and AI translation paths, so the
 * hook and the component can treat them identically.
 * `detail` optionally carries a provider's own message (the AI path returns
 * prose reasons) to append after the localized line.
 */
export type TranslateResult =
  | { ok: true; text: string }
  | { ok: false; code: TranslateFailure; detail?: string };
