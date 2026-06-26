// tests/sync/project.test.ts
import { describe, expect, it } from 'vitest';
import {
  legacyOccurrenceId,
  materialize,
  projectInbox,
  wordKey,
} from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import type { Inbox, WordEntry } from '../../lib/types';

const ctx = { replicaId: 'A', wallTime: 1000 };

function wordFixture(over: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'w1',
    kind: 'word',
    text: '你好',
    normalized: '你好',
    note: '',
    status: 'inbox',
    createdAt: 10,
    updatedAt: 20,
    occurrences: [
      { sourceTitle: 't', sourceUrl: 'u', sourceDomain: 'd', surrounding: 's', capturedAt: 15 },
    ],
    ...over,
  };
}

describe('projection identity', () => {
  it('keys words by normalized text', () => {
    expect(wordKey('你好')).toBe('word:你好');
  });

  it('derives stable, deterministic legacy occurrence ids', () => {
    const occ = { sourceTitle: 't', sourceUrl: 'u', sourceDomain: 'd', surrounding: 's', capturedAt: 15 };
    expect(legacyOccurrenceId('w1', occ)).toBe(legacyOccurrenceId('w1', { ...occ }));
    expect(legacyOccurrenceId('w1', occ)).not.toBe(legacyOccurrenceId('w2', occ));
  });
});

describe('project then materialize round-trip', () => {
  it('preserves a word and its occurrence', () => {
    const inbox: Inbox = { words: [wordFixture()], quotes: [] };
    const state = projectInbox(inbox, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctx);
    const out = materialize(state);
    expect(out.inbox.words).toHaveLength(1);
    expect(out.inbox.words[0].normalized).toBe('你好');
    expect(out.inbox.words[0].occurrences).toHaveLength(1);
  });

  it('projects portable AI fields including the api key', () => {
    const inbox: Inbox = { words: [], quotes: [] };
    const ai = { ...DEFAULT_AI_SETTINGS, apiKey: 'secret', enabled: true };
    const state = projectInbox(inbox, DEFAULT_SETTINGS, ai, ctx);
    expect(materialize(state).ai.apiKey).toBe('secret');
  });
});
