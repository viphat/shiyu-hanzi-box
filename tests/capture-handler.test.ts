import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleCapture,
  handleContextMenuCapture,
  handleManualCapture,
} from '../entrypoints/background/capture-handler';
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
    const result = await handleCapture('word');
    const inbox = await getInbox();
    expect(result).toEqual({ ok: true });
    expect(inbox.words).toHaveLength(1);
    expect(inbox.words[0].text).toBe('你好');
    expect(fakeBrowser.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      func: readPageContext,
    });
  });

  it('returns no-selection when the page has no selection', async () => {
    vi.mocked(fakeBrowser.scripting.executeScript).mockResolvedValue([{ result: null } as any]);
    const result = await handleCapture('word');
    expect(result).toEqual({ ok: false, reason: 'no-selection' });
    expect((await getInbox()).words).toHaveLength(0);
  });

  it('handles restricted pages (scripting rejects) without throwing', async () => {
    vi.mocked(fakeBrowser.scripting.executeScript).mockRejectedValue(new Error('cannot access'));
    await expect(handleCapture('word')).resolves.toEqual({
      ok: false,
      reason: 'restricted-page',
    });
    expect((await getInbox()).words).toHaveLength(0);
  });

  it('handles no active tab', async () => {
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([]);
    const result = await handleCapture('word');
    expect(result).toEqual({ ok: false, reason: 'no-active-tab' });
    expect((await getInbox()).words).toHaveLength(0);
  });
});

describe('handleCapture - quote path', () => {
  it('saves the selection as a quote', async () => {
    await handleCapture('quote');
    expect((await getInbox()).quotes).toHaveLength(1);
  });
});

describe('handleContextMenuCapture', () => {
  it('falls back to context menu selection text when scripting is restricted', async () => {
    vi.mocked(fakeBrowser.scripting.executeScript).mockRejectedValue(new Error('cannot access'));

    const result = await handleContextMenuCapture(
      'word',
      { selectionText: ' 学习 ' },
      {
        title: 'Threads',
        url: 'https://www.threads.net/@someone/post/abc',
      },
    );

    const inbox = await getInbox();
    expect(result).toEqual({ ok: true });
    expect(inbox.words).toHaveLength(1);
    expect(inbox.words[0].text).toBe('学习');
    expect(inbox.words[0].occurrences[0].sourceTitle).toBe('Threads');
    expect(inbox.words[0].occurrences[0].sourceDomain).toBe('www.threads.net');
  });

  it('returns no-selection when neither scripting nor context menu text is available', async () => {
    vi.mocked(fakeBrowser.scripting.executeScript).mockRejectedValue(new Error('cannot access'));

    const result = await handleContextMenuCapture('word', {}, {});

    expect(result).toEqual({ ok: false, reason: 'restricted-page' });
    expect((await getInbox()).words).toHaveLength(0);
  });
});

describe('handleManualCapture', () => {
  it('saves pasted text with active tab metadata', async () => {
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([
      {
        id: 1,
        active: true,
        title: 'YouTube',
        url: 'https://www.youtube.com/watch?v=abc',
      } as any,
    ]);

    const result = await handleManualCapture('word', ' 中文 ');

    const inbox = await getInbox();
    expect(result).toEqual({ ok: true });
    expect(inbox.words).toHaveLength(1);
    expect(inbox.words[0].text).toBe('中文');
    expect(inbox.words[0].occurrences[0].sourceTitle).toBe('YouTube');
    expect(inbox.words[0].occurrences[0].sourceDomain).toBe('www.youtube.com');
  });

  it('returns no-selection for empty pasted text', async () => {
    const result = await handleManualCapture('word', '   ');

    expect(result).toEqual({ ok: false, reason: 'no-selection' });
    expect((await getInbox()).words).toHaveLength(0);
  });
});
