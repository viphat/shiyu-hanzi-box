import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { saveWord, saveQuote } from '../lib/capture';
import { getInbox } from '../lib/storage';

beforeEach(() => {
  fakeBrowser.reset();
});

const src = {
  sourceTitle: 'Page',
  sourceUrl: 'https://example.com/a',
  sourceDomain: 'example.com',
  surrounding: 'context here',
  capturedAt: 1000,
};

describe('saveWord', () => {
  it('creates a new word on first capture', async () => {
    await saveWord('你好', src);
    const inbox = await getInbox();
    expect(inbox.words).toHaveLength(1);
    expect(inbox.words[0].text).toBe('你好');
    expect(inbox.words[0].normalized).toBe('你好');
    expect(inbox.words[0].occurrences).toHaveLength(1);
    expect(inbox.words[0].status).toBe('inbox');
    expect('tags' in inbox.words[0]).toBe(false);
  });

  it('dedupes by normalized text and appends an occurrence', async () => {
    await saveWord('你好', src);
    await saveWord('  你好。 ', { ...src, sourceUrl: 'https://example.com/b', capturedAt: 2000 });
    const inbox = await getInbox();
    expect(inbox.words).toHaveLength(1);
    expect(inbox.words[0].occurrences).toHaveLength(2);
    expect(inbox.words[0].occurrences[1].sourceUrl).toBe('https://example.com/b');
  });

  it('does not add duplicate occurrence when identical source+text within 5s', async () => {
    await saveWord('你好', src);
    await saveWord('你好', src);
    const inbox = await getInbox();
    expect(inbox.words[0].occurrences).toHaveLength(1);
  });

  it('ignores empty/whitespace text', async () => {
    await saveWord('   ', src);
    const inbox = await getInbox();
    expect(inbox.words).toHaveLength(0);
  });
});

describe('saveQuote', () => {
  it('creates a new quote and reports action "created"', async () => {
    const outcome = await saveQuote('学而时习之', src);
    expect(outcome).not.toBeNull();
    expect(outcome!.action).toBe('created');
    expect(outcome!.entry.tags).toEqual([]);
    expect('category' in outcome!.entry).toBe(false);
    expect((await getInbox()).quotes).toHaveLength(1);
  });

  it('suppresses an identical quote and reports action "duplicate"', async () => {
    await saveQuote('学而时习之', src);
    const outcome = await saveQuote('学而时习之', { ...src, capturedAt: 2000 });
    expect(outcome!.action).toBe('duplicate');
    expect((await getInbox()).quotes).toHaveLength(1);
  });

  it('treats whitespace/edge-punctuation variants as duplicates', async () => {
    await saveQuote('学而时习之', src);
    const outcome = await saveQuote('  学而时习之。 ', { ...src, capturedAt: 3000 });
    expect(outcome!.action).toBe('duplicate');
    expect((await getInbox()).quotes).toHaveLength(1);
  });

  it('still creates genuinely different quotes', async () => {
    await saveQuote('学而时习之', src);
    await saveQuote('有朋自远方来', { ...src, capturedAt: 4000 });
    expect((await getInbox()).quotes).toHaveLength(2);
  });

  it('leaves the existing quote untouched on duplicate (no updatedAt bump)', async () => {
    await saveQuote('学而时习之', { ...src, capturedAt: 1000 });
    const before = (await getInbox()).quotes[0].updatedAt;
    await saveQuote('学而时习之', { ...src, capturedAt: 9999 });
    expect((await getInbox()).quotes[0].updatedAt).toBe(before);
  });

  it('ignores empty text', async () => {
    const outcome = await saveQuote('', src);
    expect(outcome).toBeNull();
    expect((await getInbox()).quotes).toHaveLength(0);
  });

  it('saves a quote parked with no clozes', async () => {
    const outcome = await saveQuote('满足人们的刚需才能持续花钱', src);
    expect(outcome).not.toBeNull();
    expect((await getInbox()).quotes[0].clozes).toEqual([]);
  });
});

describe('saveWord actions', () => {
  it('reports "created" for a new word', async () => {
    const outcome = await saveWord('你好', src);
    expect(outcome!.action).toBe('created');
    expect(outcome!.entry.text).toBe('你好');
  });

  it('reports "occurrence-added" with occurrenceCapturedAt', async () => {
    await saveWord('你好', src);
    const outcome = await saveWord('你好', {
      ...src, sourceUrl: 'https://example.com/b', capturedAt: 2000,
    });
    expect(outcome!.action).toBe('occurrence-added');
    expect(outcome!.occurrenceCapturedAt).toBe(2000);
  });

  it('reports "duplicate" for a suppressed duplicate occurrence', async () => {
    await saveWord('你好', src);
    const outcome = await saveWord('你好', src);
    expect(outcome!.action).toBe('duplicate');
  });
});

