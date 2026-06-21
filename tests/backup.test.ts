import { describe, expect, it } from 'vitest';
import {
  BackupParseError,
  createBackup,
  parseBackup,
  serializeBackup,
} from '../lib/backup';
import type { Inbox, QuoteEntry, WordEntry } from '../lib/types';

const word: WordEntry = {
  id: 'w1',
  kind: 'word',
  text: '你好',
  normalized: '你好',
  note: 'common hello',
  status: 'reviewed',
  createdAt: Date.UTC(2026, 5, 20),
  updatedAt: Date.UTC(2026, 5, 21),
  pinyin: 'ni hao',
  review: {
    dueAt: Date.UTC(2026, 5, 22),
    intervalDays: 1,
    repetitions: 1,
    lapses: 0,
    lastReviewedAt: Date.UTC(2026, 5, 21),
  },
  occurrences: [
    {
      sourceTitle: 'Page',
      sourceUrl: 'https://example.com/a',
      sourceDomain: 'example.com',
      surrounding: 'context here',
      capturedAt: Date.UTC(2026, 5, 20),
    },
  ],
};

const quote: QuoteEntry = {
  id: 'q1',
  kind: 'quote',
  text: '学而时习之',
  category: 'classic',
  tags: ['论语'],
  note: '',
  status: 'inbox',
  createdAt: Date.UTC(2026, 5, 20),
  updatedAt: Date.UTC(2026, 5, 20),
  sourceTitle: 'Analects',
  sourceUrl: 'https://example.com/analects',
  sourceDomain: 'example.com',
  surrounding: '学而时习之，不亦说乎',
};

const inbox: Inbox = {
  words: [word],
  quotes: [quote],
};

describe('serializeBackup', () => {
  it('wraps the full inbox in a versioned JSON backup', () => {
    const legacyInbox = {
      words: [{ ...word, tags: ['greeting'] }],
      quotes: [quote],
    } as unknown as Inbox;
    const json = serializeBackup(legacyInbox, new Date('2026-06-20T12:34:56.000Z'));
    const backup = JSON.parse(json);

    expect(backup.inbox.words[0]).not.toHaveProperty('tags');
    expect(backup).toMatchObject({
      app: 'shiyu-hanzi-box',
      formatVersion: 1,
      exportedAt: '2026-06-20T12:34:56.000Z',
      inbox,
    });
    expect(json).toContain('\n  "app"');
  });
});

describe('parseBackup', () => {
  it('restores a valid versioned backup without sharing object references', () => {
    const backup = createBackup(inbox, new Date('2026-06-20T12:34:56.000Z'));
    const restored = parseBackup(JSON.stringify(backup));

    expect(restored).toEqual(inbox);
    expect(restored).not.toBe(inbox);
    expect(restored.words[0]).not.toBe(inbox.words[0]);
  });

  it('accepts a raw inbox JSON file as a legacy restore format', () => {
    expect(parseBackup(JSON.stringify(inbox))).toEqual(inbox);
  });

  it('restores word entries without tags', () => {
    expect(parseBackup(JSON.stringify({ words: [word], quotes: [quote] }))).toEqual({
      words: [word],
      quotes: [quote],
    });
  });

  it('strips legacy word tags on restore', () => {
    const legacyInbox = {
      words: [{ ...word, tags: ['greeting'] }],
      quotes: [quote],
    };

    expect(parseBackup(JSON.stringify(legacyInbox))).toEqual(inbox);
  });

  it('rejects malformed JSON with a typed restore error', () => {
    expect(() => parseBackup('{nope')).toThrow(BackupParseError);
  });

  it('rejects backups that do not match the persisted inbox shape', () => {
    const broken = {
      ...inbox,
      words: [{ ...word, status: 'lost' }],
    };

    expect(() => parseBackup(JSON.stringify(broken))).toThrow(
      /Invalid backup inbox/,
    );
  });
});
