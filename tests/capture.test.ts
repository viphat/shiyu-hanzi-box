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
  it('always creates a new independent quote', async () => {
    await saveQuote('学而时习之', src);
    await saveQuote('学而时习之', src);
    const inbox = await getInbox();
    expect(inbox.quotes).toHaveLength(2);
    expect(inbox.quotes[0].category).toBe('uncategorized');
  });

  it('ignores empty text', async () => {
    await saveQuote('', src);
    expect((await getInbox()).quotes).toHaveLength(0);
  });
});
