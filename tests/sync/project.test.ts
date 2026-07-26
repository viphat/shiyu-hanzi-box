import { describe, expect, it } from 'vitest';
import {
  legacyOccurrenceId,
  materialize,
  projectInbox,
  liftLegacyTags,
  wordKey,
} from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import { mergeSyncState } from '../../lib/sync/merge';
import type {
  AiInsight,
  Inbox,
  QuoteEntry,
  VietnameseAiInsight,
  WordEntry,
} from '../../lib/types';
import type { SyncState } from '../../lib/sync/types';

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

  it('round-trips independent English and Vietnamese word insights', () => {
    const english: AiInsight = {
      provider: 'deepseek', model: 'en-model', baseUrl: 'https://example.com', generatedAt: 100,
      summary: 'hello', register: 'neutral', definitions: ['hello'], sampleSentences: ['你好。'],
      translations: ['Hello.'], collocations: ['你好吗'], notes: 'English note.',
    };
    const vietnamese: VietnameseAiInsight = {
      ...english, model: 'vi-model', generatedAt: 200, summary: 'xin chào',
      translations: ['Xin chào.'], notes: 'Ghi chú.', outputLanguage: 'vi',
    };

    const state = projectInbox(
      { words: [wordFixture({ aiInsight: english, aiVietnameseInsight: vietnamese })], quotes: [] },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      ctx,
    );

    expect(materialize(state).inbox.words[0]).toMatchObject({
      aiInsight: english,
      aiVietnameseInsight: vietnamese,
    });
  });

  it('drops one malformed insight register without dropping its valid sibling', () => {
    const english: AiInsight = {
      provider: 'deepseek', model: 'en-model', baseUrl: 'https://example.com', generatedAt: 100,
      summary: 'hello', register: 'neutral', definitions: ['hello'], sampleSentences: ['你好。'],
      translations: ['Hello.'], collocations: ['你好吗'], notes: 'English note.',
    };
    const vietnamese: VietnameseAiInsight = {
      ...english, generatedAt: 200, summary: 'xin chào', translations: ['Xin chào.'],
      outputLanguage: 'vi',
    };
    const state = projectInbox(
      { words: [wordFixture({ aiInsight: english, aiVietnameseInsight: vietnamese })], quotes: [] },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      ctx,
    );
    state.words[wordKey('你好')].fields.aiInsight!.value = { summary: 42 };

    const out = materialize(state).inbox.words[0];
    expect(out.aiInsight).toBeUndefined();
    expect(out.aiVietnameseInsight).toEqual(vietnamese);
  });

  it('projects a null legacy English insight without crashing or dropping valid Vietnamese', () => {
    const vietnamese: VietnameseAiInsight = {
      provider: 'deepseek', model: 'vi-model', baseUrl: 'https://example.com', generatedAt: 200,
      summary: 'xin chào', register: 'neutral', definitions: ['lời chào'],
      sampleSentences: ['你好。'], translations: ['Xin chào.'], collocations: ['你好吗'],
      notes: 'Ghi chú.', outputLanguage: 'vi',
    };
    const unsafeWord = wordFixture({
      aiInsight: null as never,
      aiVietnameseInsight: vietnamese,
    });

    const state = projectInbox(
      { words: [unsafeWord], quotes: [] },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      ctx,
    );

    expect(materialize(state).inbox.words[0].aiInsight).toBeUndefined();
    expect(materialize(state).inbox.words[0].aiVietnameseInsight).toEqual(vietnamese);
  });
});

function quoteFixture(over: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: 'hi',
    note: '',
    status: 'inbox',
    tags: [],
    createdAt: 10,
    updatedAt: 20,
    sourceTitle: '',
    sourceUrl: '',
    sourceDomain: '',
    surrounding: '',
    ...over,
  } as QuoteEntry;
}

function project(inbox: { quotes: QuoteEntry[] }, persisted?: SyncState) {
  return projectInbox(
    { words: [], quotes: inbox.quotes },
    DEFAULT_SETTINGS,
    DEFAULT_AI_SETTINGS,
    ctx,
    persisted,
  );
}

describe('quote tags OR-Set projection', () => {
  it('projects local tags into the add-stamp map with empty tombstones', () => {
    const state = project({ quotes: [quoteFixture({ tags: ['a', 'b'] })] });
    expect(Object.keys(state.quotes.q1.tags ?? {}).sort()).toEqual(['a', 'b']);
    expect(state.quotes.q1.tagTombstones).toEqual({});
  });

  it('round-trips tags through materialize, sorted', () => {
    const state = project({ quotes: [quoteFixture({ tags: ['b', 'a'] })] });
    expect(materialize(state).inbox.quotes[0].tags).toEqual(['a', 'b']);
  });

  it('carries forward an existing tag add stamp (unrelated edit does not move it)', () => {
    const first = project({ quotes: [quoteFixture({ tags: ['a'], updatedAt: 20 })] });
    const addStampBefore = first.quotes.q1.tags!.a;
    // Unrelated edit bumps updatedAt; persisted state seeded as `prev`.
    const second = project(
      { quotes: [quoteFixture({ tags: ['a'], updatedAt: 999 })] },
      first,
    );
    expect(second.quotes.q1.tags!.a).toEqual(addStampBefore);
  });

  it('mints a re-add stamp strictly above a prior tombstone (closes same-ms race)', () => {
    const prev: SyncState = {
      ...project({ quotes: [quoteFixture({ tags: [] })] }),
    };
    prev.quotes.q1.tags = {};
    prev.quotes.q1.tagTombstones = { a: { wallTime: 5000, counter: 0, replicaId: 'A' } };
    // Re-add at the same wallTime as the tombstone.
    const state = project(
      { quotes: [quoteFixture({ tags: ['a'], updatedAt: 5000 })] },
      prev,
    );
    expect(state.quotes.q1.tags!.a.wallTime).toBe(5001);
  });

  it('liftLegacyTags folds a legacy fields.tags register into the OR-Set', () => {
    const node = {
      id: 'q1',
      fields: { tags: { value: ['legacy'], stamp: { wallTime: 7, counter: 0, replicaId: 'A' } } },
      createdAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } },
      reviewEvents: {},
    } as never;
    const lifted = liftLegacyTags(node);
    expect(Object.keys(lifted.tags ?? {})).toEqual(['legacy']);
    expect(lifted.tags!.legacy.wallTime).toBe(7);
  });

  it('materialize reads a node with no tags/tagTombstones without throwing', () => {
    const state = project({ quotes: [quoteFixture({ tags: ['a'] })] });
    delete state.quotes.q1.tags;
    delete state.quotes.q1.tagTombstones;
    expect(() => materialize(state)).not.toThrow();
    expect(materialize(state).inbox.quotes[0].tags).toEqual([]);
  });
});

const AI_SLOT = {
  text: 'To learn and practise often',
  generatedAt: 300,
  provider: 'deepseek' as const,
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com',
};

describe('quote translation sync', () => {
  it('round-trips both translation slots', () => {
    const quote = quoteFixture({
      translations: {
        google: { text: 'Learning is a joy', generatedAt: 200 },
        ai: AI_SLOT,
      },
    });
    const state = projectInbox({ words: [], quotes: [quote] }, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctx);

    const out = materialize(state).inbox.quotes[0];

    expect(out.translations?.google).toEqual({ text: 'Learning is a joy', generatedAt: 200 });
    expect(out.translations?.ai).toEqual(AI_SLOT);
  });

  it('omits translations entirely for an untranslated quote', () => {
    const state = projectInbox({ words: [], quotes: [quoteFixture()] }, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctx);

    expect(materialize(state).inbox.quotes[0].translations).toBeUndefined();
  });

  it('round-trips a quote with only the Google slot', () => {
    const quote = quoteFixture({
      translations: { google: { text: 'Learning is a joy', generatedAt: 200 } },
    });
    const state = projectInbox({ words: [], quotes: [quote] }, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctx);

    const out = materialize(state).inbox.quotes[0];

    expect(out.translations?.google?.text).toBe('Learning is a joy');
    expect(out.translations?.ai).toBeUndefined();
  });

  it('keeps both slots when two replicas each translated with a different source', () => {
    // Replica A translated with Google; replica B translated the same quote
    // with AI. Separate registers mean neither write loses.
    const stateA = projectInbox(
      {
        words: [],
        quotes: [
          quoteFixture({
            updatedAt: 100,
            translations: { google: { text: 'Learning is a joy', generatedAt: 100 } },
          }),
        ],
      },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      { replicaId: 'A', wallTime: 100 },
    );
    const stateB = projectInbox(
      { words: [], quotes: [quoteFixture({ updatedAt: 300, translations: { ai: AI_SLOT } })] },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      { replicaId: 'B', wallTime: 300 },
    );

    const out = materialize(mergeSyncState(stateA, stateB)).inbox.quotes[0];

    expect(out.translations?.google?.text).toBe('Learning is a joy');
    expect(out.translations?.ai?.text).toBe('To learn and practise often');
  });

  it('resolves the same translation slot by recency, in either merge order', () => {
    const older = quoteFixture({
      updatedAt: 100,
      translations: { google: { text: 'older rendering', generatedAt: 100 } },
    });
    const newer = quoteFixture({
      updatedAt: 300,
      translations: { google: { text: 'newer rendering', generatedAt: 300 } },
    });
    const a = projectInbox({ words: [], quotes: [older] }, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, { replicaId: 'A', wallTime: 100 });
    const b = projectInbox({ words: [], quotes: [newer] }, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, { replicaId: 'B', wallTime: 300 });

    expect(materialize(mergeSyncState(a, b)).inbox.quotes[0].translations?.google?.text).toBe('newer rendering');
    expect(materialize(mergeSyncState(b, a)).inbox.quotes[0].translations?.google?.text).toBe('newer rendering');
  });

  it('does not let a replica lacking a slot erase a peer that has one', () => {
    const translated = quoteFixture({
      updatedAt: 100,
      translations: { google: { text: 'kept rendering', generatedAt: 100 } },
    });
    // Same quote, edited LATER, but with no translation at all. Its newer
    // stamp must not be able to clear the peer's real translation, because an
    // absent slot writes no register rather than a null.
    const untranslatedButNewer = quoteFixture({ updatedAt: 900 });
    const a = projectInbox({ words: [], quotes: [translated] }, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, { replicaId: 'A', wallTime: 100 });
    const b = projectInbox({ words: [], quotes: [untranslatedButNewer] }, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, { replicaId: 'B', wallTime: 900 });

    expect(materialize(mergeSyncState(a, b)).inbox.quotes[0].translations?.google?.text).toBe('kept rendering');
    expect(materialize(mergeSyncState(b, a)).inbox.quotes[0].translations?.google?.text).toBe('kept rendering');
  });

  it('stamps a translation register by its own generatedAt, so an unrelated later edit cannot revert a peer\'s newer translation', () => {
    // Replica A translated first (generatedAt 100) but then made an unrelated
    // edit (e.g. its note) much later, bumping quote.updatedAt to 900.
    // Replica B translated later (generatedAt 200, so B's translation should
    // win) but never touched the quote again, so its updatedAt stays at 150.
    // If the register were stamped with the shared `s = stamp(updatedAt, …)`
    // like its sibling fields, A's stale translation (updatedAt 900) would
    // beat B's newer one (updatedAt 150) on merge — which is wrong, since the
    // translation itself is older. Stamping by generatedAt fixes this.
    const a = projectInbox(
      {
        words: [],
        quotes: [
          quoteFixture({
            updatedAt: 900,
            translations: { google: { text: 'A older translation', generatedAt: 100 } },
          }),
        ],
      },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      { replicaId: 'A', wallTime: 900 },
    );
    const b = projectInbox(
      {
        words: [],
        quotes: [
          quoteFixture({
            updatedAt: 150,
            translations: { google: { text: 'B newer translation', generatedAt: 200 } },
          }),
        ],
      },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      { replicaId: 'B', wallTime: 150 },
    );

    expect(materialize(mergeSyncState(a, b)).inbox.quotes[0].translations?.google?.text).toBe(
      'B newer translation',
    );
    expect(materialize(mergeSyncState(b, a)).inbox.quotes[0].translations?.google?.text).toBe(
      'B newer translation',
    );
  });

  it('materializes without a malformed translationGoogle register value (hostile replica)', () => {
    const state = projectInbox(
      { words: [], quotes: [quoteFixture({ translations: { google: { text: 'ok', generatedAt: 100 } } })] },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      ctx,
    );
    // Simulate a hostile/corrupt peer replica by overwriting the register
    // value directly with a shape that fails the QuoteTranslation schema.
    state.quotes.q1.fields.translationGoogle!.value = { text: 42, generatedAt: 100 } as never;

    expect(() => materialize(state)).not.toThrow();
    expect(materialize(state).inbox.quotes[0].translations).toBeUndefined();
  });

  it('keeps a valid ai slot when the sibling google register value is malformed', () => {
    const state = projectInbox(
      {
        words: [],
        quotes: [
          quoteFixture({
            translations: {
              google: { text: 'ok', generatedAt: 100 },
              ai: AI_SLOT,
            },
          }),
        ],
      },
      DEFAULT_SETTINGS,
      DEFAULT_AI_SETTINGS,
      ctx,
    );
    state.quotes.q1.fields.translationGoogle!.value = { text: 42, generatedAt: 100 } as never;

    const out = materialize(state).inbox.quotes[0];
    expect(out.translations?.google).toBeUndefined();
    expect(out.translations?.ai).toEqual(AI_SLOT);
  });
});
