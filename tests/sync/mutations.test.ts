import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  applyLocalMutation,
  applyQuoteTranslation,
  reconcileOnStartup,
  syncMetadataStorage,
} from '../../lib/sync/mutations';
import { getSyncConfig } from '../../lib/sync/local';
import { getInbox, setInbox } from '../../lib/storage';
import type { QuoteEntry } from '../../lib/types';

describe('local mutation protocol', () => {
  beforeEach(() => fakeBrowser.reset());

  it('bumps a shared revision and marks pending', async () => {
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [] });
    });
    const cfg = await getSyncConfig();
    const meta = await syncMetadataStorage.getValue();
    expect(cfg.pending).toBe(true);
    expect(cfg.localRevision).toBe(meta.revision);
    expect(cfg.localRevision).toBeGreaterThan(0);
  });

  function makeQuote(over: Partial<QuoteEntry> = {}): QuoteEntry {
    return {
      id: 'q1',
      kind: 'quote',
      text: '学而时习之',
      tags: [],
      note: '',
      status: 'inbox',
      createdAt: 1,
      updatedAt: 1,
      sourceTitle: 'Lunyu',
      sourceUrl: 'https://lunyu.com',
      sourceDomain: 'lunyu.com',
      surrounding: '不亦说乎',
      ...over,
    };
  }

  describe('applyQuoteTranslation', () => {
    it('sets the named slot on the named quote', async () => {
      const quote = makeQuote({ id: 'q1' });
      await setInbox({ words: [], quotes: [quote] });

      await applyQuoteTranslation({
        quoteId: 'q1',
        slot: 'google',
        value: { text: 'Learning is a joy', generatedAt: 100 },
      });

      const inbox = await getInbox();
      expect(inbox.quotes[0].translations?.google?.text).toBe('Learning is a joy');
    });

    it('preserves the sibling slot when one already exists', async () => {
      const quote = makeQuote({
        id: 'q1',
        translations: {
          ai: {
            text: 'Nature shows no favour',
            generatedAt: 50,
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            baseUrl: 'https://api.deepseek.com',
          },
        },
      });
      await setInbox({ words: [], quotes: [quote] });

      await applyQuoteTranslation({
        quoteId: 'q1',
        slot: 'google',
        value: { text: 'G text', generatedAt: 100 },
      });

      const inbox = await getInbox();
      const translations = inbox.quotes[0].translations!;
      expect(translations.google?.text).toBe('G text');
      expect(translations.ai?.text).toBe('Nature shows no favour');
    });

    it('leaves other quotes byte-identical', async () => {
      const target = makeQuote({ id: 'q1' });
      const other = makeQuote({ id: 'q2', text: '不亦说乎', updatedAt: 5 });
      await setInbox({ words: [], quotes: [target, other] });

      await applyQuoteTranslation({
        quoteId: 'q1',
        slot: 'google',
        value: { text: 'G text', generatedAt: 100 },
      });

      const inbox = await getInbox();
      const untouched = inbox.quotes.find((q) => q.id === 'q2');
      expect(untouched).toEqual(other);
    });

    it("bumps only the target quote's updatedAt", async () => {
      const target = makeQuote({ id: 'q1', updatedAt: 1 });
      const other = makeQuote({ id: 'q2', text: '不亦说乎', updatedAt: 5 });
      await setInbox({ words: [], quotes: [target, other] });

      await applyQuoteTranslation({
        quoteId: 'q1',
        slot: 'google',
        value: { text: 'G text', generatedAt: 100 },
      });

      const inbox = await getInbox();
      expect(inbox.quotes.find((q) => q.id === 'q1')!.updatedAt).toBeGreaterThan(1);
      expect(inbox.quotes.find((q) => q.id === 'q2')!.updatedAt).toBe(5);
    });

    it('no-ops without resurrecting when the quoteId is not present', async () => {
      const quote = makeQuote({ id: 'q1' });
      await setInbox({ words: [], quotes: [quote] });

      await applyQuoteTranslation({
        quoteId: 'does-not-exist',
        slot: 'google',
        value: { text: 'G text', generatedAt: 100 },
      });

      const inbox = await getInbox();
      expect(inbox.quotes).toHaveLength(1);
      expect(inbox.quotes[0]).toEqual(quote);
    });
  });

  it('reconciles mismatched revisions without dropping domain data', async () => {
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [] });
    });
    // Simulate an interrupted write: metadata revision behind config.
    await syncMetadataStorage.setValue({ revision: 0, state: null, lastDigest: null, appSettingsUpdatedAt: 0, aiSettingsUpdatedAt: 0 });
    await reconcileOnStartup();
    const cfg = await getSyncConfig();
    const meta = await syncMetadataStorage.getValue();
    expect(meta.revision).toBe(cfg.localRevision);
    expect(meta.state).not.toBeNull();
    expect(cfg.pending).toBe(true);
  });
});
