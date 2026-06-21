import type { Occurrence } from './types';

export function occurrenceSourceLabel(occurrence: Occurrence): string {
  const direct = occurrence.sourceTitle.trim() || occurrence.sourceDomain.trim();
  if (direct) return direct;

  const url = occurrence.sourceUrl.trim();
  if (!url) return '';

  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function hasDisplayableOccurrence(occurrence: Occurrence): boolean {
  return (
    occurrenceSourceLabel(occurrence).length > 0 ||
    occurrence.surrounding.trim().length > 0
  );
}

export function displayableOccurrences(occurrences: Occurrence[]): Occurrence[] {
  return occurrences.filter(hasDisplayableOccurrence);
}

export function latestDisplayableOccurrence(
  occurrences: Occurrence[],
): Occurrence | undefined {
  return displayableOccurrences(occurrences).reduce<Occurrence | undefined>(
    (latest, occurrence) =>
      !latest || occurrence.capturedAt > latest.capturedAt ? occurrence : latest,
    undefined,
  );
}
