import { describe, expect, it } from 'vitest';
import {
  displayableOccurrences,
  latestDisplayableOccurrence,
  occurrenceSourceLabel,
} from '../lib/occurrences';
import type { Occurrence } from '../lib/types';

const occurrence = (over: Partial<Occurrence>): Occurrence => ({
  sourceTitle: '',
  sourceUrl: '',
  sourceDomain: '',
  surrounding: '',
  capturedAt: 1,
  ...over,
});

describe('occurrence display helpers', () => {
  it('does not count fully empty occurrences as displayable', () => {
    const occurrences = [
      occurrence({}),
      occurrence({ sourceTitle: 'Page', sourceDomain: 'example.com' }),
    ];

    expect(displayableOccurrences(occurrences)).toHaveLength(1);
  });

  it('uses the newest non-empty occurrence when the newest raw occurrence is empty', () => {
    const older = occurrence({
      sourceTitle: 'Reader',
      sourceDomain: 'reader.example',
      capturedAt: 10,
    });
    const emptyNewest = occurrence({ capturedAt: 20 });

    expect(latestDisplayableOccurrence([older, emptyNewest])).toBe(older);
  });

  it('falls back to sourceUrl hostname for the display label', () => {
    expect(
      occurrenceSourceLabel(
        occurrence({ sourceUrl: 'https://news.example/article', capturedAt: 1 }),
      ),
    ).toBe('news.example');
  });
});
