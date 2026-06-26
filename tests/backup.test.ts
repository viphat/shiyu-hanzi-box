import { describe, expect, it } from 'vitest';
import {
  BackupParseError,
  createBackup,
  parseBackup,
  serializeBackup,
} from '../lib/backup';
import type {
  Inbox,
  QuoteEntry,
  ReviewState,
  WordEntry,
} from '../lib/types';

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
      formatVersion: 2,
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

const fsrsReview: ReviewState = {
  scheduler: 'fsrs-v1',
  dueAt: Date.UTC(2026, 5, 22),
  intervalDays: 3,
  repetitions: 2,
  lapses: 0,
  lastReviewedAt: Date.UTC(2026, 5, 21),
  cardState: 'review',
  stability: 3,
  difficulty: 5.5,
  elapsedDays: 3,
  scheduledDays: 3,
  learningSteps: 0,
  retrievability: 0.9,
  reviewLog: [
    {
      reviewedAt: Date.UTC(2026, 5, 21),
      rating: 'good',
      elapsedDays: 0,
      scheduledDays: 3,
      stateBefore: 'new',
      stateAfter: 'review',
      stabilityBefore: 0.1,
      stabilityAfter: 3,
      difficultyBefore: 5,
      difficultyAfter: 5,
    },
  ],
};

describe('parseBackup with FSRS review state', () => {
  it('accepts valid fsrs-v1 review state', () => {
    const inboxWithFsrs: Inbox = {
      words: [{ ...word, review: fsrsReview }],
      quotes: [],
    };
    const restored = parseBackup(serializeBackup(inboxWithFsrs));
    expect(restored.words[0].review).toEqual(fsrsReview);
  });

  it('rejects an invalid scheduler value', () => {
    const broken = {
      ...inbox,
      words: [
        {
          ...word,
          review: { ...fsrsReview, scheduler: 'unknown' },
        },
      ],
    };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(
      BackupParseError,
    );
  });

  it('rejects an invalid cardState value', () => {
    const broken = {
      ...inbox,
      words: [
        {
          ...word,
          review: { ...fsrsReview, cardState: 'frozen' },
        },
      ],
    };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(
      BackupParseError,
    );
  });

  it('rejects a malformed learning step index', () => {
    const broken = {
      ...inbox,
      words: [
        {
          ...word,
          review: { ...fsrsReview, learningSteps: -1 },
        },
      ],
    };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(
      BackupParseError,
    );
  });

  it.each([
    ['intervalDays', -1],
    ['repetitions', -1],
    ['repetitions', 1.5],
    ['lapses', -1],
    ['lapses', 1.5],
    ['stability', -0.1],
    ['difficulty', 0.9],
    ['difficulty', 10.1],
    ['elapsedDays', -1],
    ['scheduledDays', -1],
    ['retrievability', -0.1],
    ['retrievability', 1.1],
  ] as const)(
    'rejects an out-of-range FSRS %s value',
    (field, invalidValue) => {
      const broken = {
        ...inbox,
        words: [
          {
            ...word,
            review: { ...fsrsReview, [field]: invalidValue },
          },
        ],
      };

      expect(() => parseBackup(JSON.stringify(broken))).toThrow(
        BackupParseError,
      );
    },
  );

  it('rejects a malformed review log entry', () => {
    const broken = {
      ...inbox,
      words: [
        {
          ...word,
          review: {
            ...fsrsReview,
            reviewLog: [
              { reviewedAt: 'not-a-number', rating: 'good' },
            ],
          },
        },
      ],
    };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(
      BackupParseError,
    );
  });
});

describe('parseBackup version compatibility', () => {
  it('accepts a v1 backup (formatVersion 1) and imports quotes with no clozes', () => {
    const v1Envelope = {
      app: 'shiyu-hanzi-box',
      formatVersion: 1,
      exportedAt: '2026-06-20T12:34:56.000Z',
      inbox: {
        words: [word],
        quotes: [quote],
      },
    };
    const restored = parseBackup(JSON.stringify(v1Envelope));
    expect(restored.quotes[0]).toEqual(quote);
    expect(restored.quotes[0].clozes).toBeUndefined();
  });

  it('accepts a v2 backup with valid clozes and round-trips them unchanged', () => {
    const quoteWithClozes: QuoteEntry = {
      ...quote,
      clozes: [
        { id: 'c1', start: 0, end: 1 },
        { id: 'c2', start: 2, end: 4, hint: 'pinyin', wordId: 'w1' },
      ],
    };
    const inboxWithClozes: Inbox = { words: [word], quotes: [quoteWithClozes] };
    const backup = createBackup(inboxWithClozes, new Date('2026-06-20T12:34:56.000Z'));
    // Ensure version is 2
    expect(backup.formatVersion).toBe(2);
    const restored = parseBackup(JSON.stringify(backup));
    expect(restored.quotes[0].clozes).toEqual(quoteWithClozes.clozes);
  });

  it('rejects a backup with formatVersion greater than the current version', () => {
    const futureEnvelope = {
      app: 'shiyu-hanzi-box',
      formatVersion: 9999,
      exportedAt: '2026-06-20T12:34:56.000Z',
      inbox: { words: [], quotes: [] },
    };
    expect(() => parseBackup(JSON.stringify(futureEnvelope))).toThrow(
      BackupParseError,
    );
  });
});

describe('parseBackup cloze sanitization', () => {
  it('imports successfully and sets clozes to [] when a cloze has end > text.length', () => {
    const badQuote: QuoteEntry = {
      ...quote,
      // quote.text is '学而时习之' (length 5); end=99 is out of range
      clozes: [{ id: 'c1', start: 0, end: 99 }],
    };
    const restored = parseBackup(
      JSON.stringify({ words: [word], quotes: [badQuote] }),
    );
    expect(restored.quotes[0].clozes).toEqual([]);
  });

  it('imports successfully and sets clozes to [] when a cloze is missing id', () => {
    const badQuote = {
      ...quote,
      clozes: [{ start: 0, end: 2 }], // no id field
    };
    const restored = parseBackup(
      JSON.stringify({ words: [word], quotes: [badQuote as unknown as QuoteEntry] }),
    );
    expect(restored.quotes[0].clozes).toEqual([]);
  });

  it('imports successfully and sets clozes to [] when two clozes overlap', () => {
    const badQuote: QuoteEntry = {
      ...quote,
      // [0,3) and [2,5) overlap
      clozes: [
        { id: 'c1', start: 0, end: 3 },
        { id: 'c2', start: 2, end: 5 },
      ],
    };
    const restored = parseBackup(
      JSON.stringify({ words: [word], quotes: [badQuote] }),
    );
    expect(restored.quotes[0].clozes).toEqual([]);
  });

  it('imports successfully and sets clozes to [] for a cloze with start >= end', () => {
    const badQuote: QuoteEntry = {
      ...quote,
      clozes: [{ id: 'c1', start: 3, end: 3 }], // start === end
    };
    const restored = parseBackup(
      JSON.stringify({ words: [word], quotes: [badQuote] }),
    );
    expect(restored.quotes[0].clozes).toEqual([]);
  });

  it('keeps valid clozes and leaves absent clozes untouched on the same import', () => {
    const quoteWithClozes: QuoteEntry = {
      ...quote,
      id: 'q2',
      clozes: [{ id: 'c1', start: 0, end: 2 }],
    };
    const quoteNoClozes: QuoteEntry = { ...quote, id: 'q3' };
    const restored = parseBackup(
      JSON.stringify({
        words: [],
        quotes: [quoteWithClozes, quoteNoClozes],
      }),
    );
    expect(restored.quotes[0].clozes).toEqual([{ id: 'c1', start: 0, end: 2 }]);
    expect(restored.quotes[1].clozes).toBeUndefined();
  });
});
