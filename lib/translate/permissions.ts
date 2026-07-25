import { browser } from 'wxt/browser';

export const GOOGLE_TRANSLATE_ORIGIN = 'https://translate.googleapis.com/*';

/**
 * Lazily request the Google Translate host permission. Must be called from a
 * user gesture (a button click), mirroring lib/ai/permissions.ts.
 */
export async function requestGoogleTranslatePermission(): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: [GOOGLE_TRANSLATE_ORIGIN] });
  } catch {
    return false;
  }
}

export async function hasGoogleTranslatePermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [GOOGLE_TRANSLATE_ORIGIN] });
  } catch {
    return false;
  }
}
