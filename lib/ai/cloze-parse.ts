import { clozesOverlap } from '../cloze';
import { makeId } from '../id';
import type { Cloze } from '../types';

export interface ClozeSuggestion {
  answer: string;
  reason?: string;
}

export interface ClozeCandidate {
  cloze: Cloze;
  reason?: string;
}

export function parseClozeSuggestions(
  content: string,
): { ok: true; suggestions: ClozeSuggestion[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'Response is not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'Response is not a JSON object.' };
  }
  const blanks = (parsed as Record<string, unknown>).blanks;
  if (!Array.isArray(blanks)) {
    return { ok: false, reason: 'Response schema mismatch: missing blanks array.' };
  }

  const suggestions: ClozeSuggestion[] = [];
  for (const item of blanks) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const answer = rec.answer;
    if (typeof answer !== 'string' || answer.trim() === '') continue;
    const reason = typeof rec.reason === 'string' ? rec.reason : undefined;
    suggestions.push({ answer, reason });
  }
  return { ok: true, suggestions };
}

function locateUncovered(
  text: string,
  answer: string,
  covered: Cloze[],
): { start: number; end: number } | null {
  let from = 0;
  while (from <= text.length - answer.length) {
    const idx = text.indexOf(answer, from);
    if (idx === -1) return null;
    const end = idx + answer.length;
    const overlaps = covered.some((c) => idx < c.end && end > c.start);
    if (!overlaps) return { start: idx, end };
    from = idx + 1;
  }
  return null;
}

/**
 * Map AI answer strings to non-overlapping cloze candidates against `text`,
 * skipping spans already covered by `existing`. Longer answers win overlap
 * contests; results are returned in document order. Carries `reason` through.
 */
export function suggestionsToCandidates(
  text: string,
  suggestions: ClozeSuggestion[],
  existing: Cloze[],
): ClozeCandidate[] {
  const accepted: Cloze[] = [...existing];
  const out: ClozeCandidate[] = [];

  const ordered = [...suggestions].sort((a, b) => b.answer.length - a.answer.length);
  for (const s of ordered) {
    const span = locateUncovered(text, s.answer, accepted);
    if (!span) continue;
    const cloze: Cloze = { id: makeId(), start: span.start, end: span.end };
    if (clozesOverlap([...accepted, cloze])) continue;
    accepted.push(cloze);
    out.push({ cloze, reason: s.reason });
  }

  return out.sort((a, b) => a.cloze.start - b.cloze.start);
}
