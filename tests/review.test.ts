import { describe, expect, it } from 'vitest';
import type { Inbox, WordEntry } from '../lib/types';
import { migrateReviewState } from '../lib/srs';
import { buildReviewQueue } from '../lib/review';

const NOW = new Date('2026-06-20T10:30:00').getTime();
const YESTERDAY = new Date('2026-06-19T08:00:00').getTime();

function word(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'word-1',
    kind: 'word',
    text: '山水',
    normalized: '山水',
    note: '',
    status: 'inbox',
    createdAt: YESTERDAY,
    updatedAt: YESTERDAY,
    occurrences: [],
    ...overrides,
  };
}

describe('review compatibility layer', () => {
  it('buildReviewQueue delegates to the SRS queue builder', () => {
    const inbox: Inbox = {
      words: [
        migrateReviewState(word({ id: 'due' })),
        migrateReviewState(word({ id: 'archived', status: 'archived' })),
      ],
      quotes: [],
    };
    const ids = buildReviewQueue(inbox, NOW).map((item) => item.entry.id);
    expect(ids).toEqual(['due']);
  });
});
