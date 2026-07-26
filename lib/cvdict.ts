import type { CedictStreamResult } from './dictionary';
import type { DictionaryEntry } from './types';

export const CVDICT_SOURCE_URL = 'https://raw.githubusercontent.com/ph0ngp/CVDICT/main/CVDICT.u8';
export const MAX_CVDICT_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export function isCvdictSizeAllowed(byteCount: number): boolean {
  return Number.isFinite(byteCount) && byteCount >= 0 && byteCount <= MAX_CVDICT_DOWNLOAD_BYTES;
}

export function isCvdictResultValid(result: CedictStreamResult): boolean {
  return result.entries.length > 0
    && Boolean(result.metadata.version?.trim())
    && Boolean(result.metadata.release?.trim());
}

export function hashDictionaryEntries(entries: DictionaryEntry[]): string {
  const json = JSON.stringify(entries);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
