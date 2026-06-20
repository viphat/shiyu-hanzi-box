import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleCapture } from '../entrypoints/background/capture-handler';
import { getInbox } from '../lib/storage';
import { readPageContext } from '../lib/page-context';

const GOOD_CTX = {
  text: '你好',
  surrounding: 'context',
  sourceTitle: 'Page',
  sourceUrl: 'https://example.com/a',
  sourceDomain: 'example.com',
};

beforeEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
  // default happy path: active tab exists, scripting returns a selection
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 1, active: true } as any]);
  vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([
    { result: GOOD_CTX } as any,
  ]);
});

describe('handleCapture - word path', () => {
  it('saves the selection as a word', async () => {
    await handleCapture('word');
    const inbox = await getInbox();
    expect(inbox.words).toHaveLength(1);
    expect(inbox.words[0].text).toBe('你好');
    expect(fakeBrowser.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      func: readPageContext,
    });
  });

  it('returns no-selection when the page has no selection', async () => {
    vi.mocked(fakeBrowser.scripting.executeScript).mockResolvedValue([{ result: null } as any]);
    await handleCapture('word');
    expect((await getInbox()).words).toHaveLength(0);
  });

  it('handles restricted pages (scripting rejects) without throwing', async () => {
    vi.mocked(fakeBrowser.scripting.executeScript).mockRejectedValue(new Error('cannot access'));
    await expect(handleCapture('word')).resolves.not.toThrow();
    expect((await getInbox()).words).toHaveLength(0);
  });

  it('handles no active tab', async () => {
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([]);
    await handleCapture('word');
    expect((await getInbox()).words).toHaveLength(0);
  });
});

describe('handleCapture - quote path', () => {
  it('saves the selection as a quote', async () => {
    await handleCapture('quote');
    expect((await getInbox()).quotes).toHaveLength(1);
  });
});
