import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleCapture,
  handleContextMenuCapture,
  handleManualCapture,
} from '../entrypoints/background/capture-handler';
import { getInbox } from '../lib/storage';
import { readPageContext, readPageMetadata } from '../lib/page-context';
import { renderCaptureToast } from '../lib/capture-toast';

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
    expect(result.ok).toBe(true);
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

describe('handleCapture - non-source pages leave the occurrence blank', () => {
  const NEW_TAB_CTX = {
    text: '你好',
    surrounding: 'context',
    sourceTitle: 'New Tab',
    sourceUrl: 'chrome://newtab/',
    sourceDomain: '',
  };
  const BLANK_CTX = {
    text: '你好',
    surrounding: 'context',
    sourceTitle: '',
    sourceUrl: 'about:blank',
    sourceDomain: '',
  };

  it('still saves the word but blanks source + surrounding for the New Tab Page', async () => {
    vi.mocked(fakeBrowser.scripting.executeScript).mockResolvedValue([
      { result: NEW_TAB_CTX } as any,
    ]);
    const result = await handleCapture('word');
    expect(result.ok).toBe(true);
    const [word] = (await getInbox()).words;
    expect(word.text).toBe('你好');
    expect(word.occurrences).toHaveLength(1);
    expect(word.occurrences[0].sourceTitle).toBe('');
    expect(word.occurrences[0].sourceUrl).toBe('');
    expect(word.occurrences[0].sourceDomain).toBe('');
    expect(word.occurrences[0].surrounding).toBe('');
  });

  it('still saves the quote but blanks the source for a blank page', async () => {
    vi.mocked(fakeBrowser.scripting.executeScript).mockResolvedValue([
      { result: BLANK_CTX } as any,
    ]);
    await handleCapture('quote');
    const [quote] = (await getInbox()).quotes;
    expect(quote.text).toBe('你好');
    expect(quote.sourceTitle).toBe('');
    expect(quote.sourceUrl).toBe('');
    expect(quote.sourceDomain).toBe('');
    expect(quote.surrounding).toBe('');
  });
});

describe('handleContextMenuCapture - non-source pages leave the occurrence blank', () => {
  it('blanks tab metadata when the restricted page is the New Tab Page', async () => {
    vi.mocked(fakeBrowser.scripting.executeScript).mockRejectedValue(new Error('cannot access'));

    const result = await handleContextMenuCapture(
      'word',
      { selectionText: ' 学习 ' },
      { title: 'New Tab', url: 'chrome://newtab/' },
    );

    const inbox = await getInbox();
    expect(result.ok).toBe(true);
    expect(inbox.words[0].text).toBe('学习');
    expect(inbox.words[0].occurrences[0].sourceTitle).toBe('');
    expect(inbox.words[0].occurrences[0].sourceUrl).toBe('');
    expect(inbox.words[0].occurrences[0].sourceDomain).toBe('');
  });
});

describe('handleManualCapture - non-source pages leave the occurrence blank', () => {
  it('blanks source for pasted text captured on the extension dashboard', async () => {
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([
      {
        id: 1,
        active: true,
        title: '拾语汉字box',
        url: 'chrome-extension://abcdef/dashboard.html',
      } as any,
    ]);
    vi.mocked(fakeBrowser.scripting.executeScript).mockResolvedValue([
      {
        result: {
          sourceTitle: '拾语汉字box',
          sourceUrl: 'chrome-extension://abcdef/dashboard.html',
          sourceDomain: '',
        },
      } as any,
    ]);

    const result = await handleManualCapture('word', ' 中文 ');

    const inbox = await getInbox();
    expect(result.ok).toBe(true);
    expect(inbox.words[0].text).toBe('中文');
    expect(inbox.words[0].occurrences[0].sourceTitle).toBe('');
    expect(inbox.words[0].occurrences[0].sourceUrl).toBe('');
    expect(inbox.words[0].occurrences[0].sourceDomain).toBe('');
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
    expect(result.ok).toBe(true);
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
  it('falls back to active tab metadata for pasted text when page metadata is unavailable', async () => {
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([
      {
        id: 1,
        active: true,
        title: 'YouTube',
        url: 'https://www.youtube.com/watch?v=abc',
      } as any,
    ]);
    vi.mocked(fakeBrowser.scripting.executeScript).mockRejectedValue(new Error('cannot access'));

    const result = await handleManualCapture('word', ' 中文 ');

    const inbox = await getInbox();
    expect(result.ok).toBe(true);
    expect(inbox.words).toHaveLength(1);
    expect(inbox.words[0].text).toBe('中文');
    expect(inbox.words[0].occurrences[0].sourceTitle).toBe('YouTube');
    expect(inbox.words[0].occurrences[0].sourceDomain).toBe('www.youtube.com');
  });

  it('reads page metadata for pasted text when tab metadata is sparse', async () => {
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([
      {
        id: 1,
        active: true,
      } as any,
    ]);
    vi.mocked(fakeBrowser.scripting.executeScript).mockResolvedValue([
      {
        result: {
          sourceTitle: 'Reader Page',
          sourceUrl: 'https://reader.example/article',
          sourceDomain: 'reader.example',
        },
      } as any,
    ]);

    const result = await handleManualCapture('word', ' 中文 ');

    const inbox = await getInbox();
    expect(result.ok).toBe(true);
    expect(fakeBrowser.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      func: readPageMetadata,
    });
    expect(inbox.words[0].occurrences[0].sourceTitle).toBe('Reader Page');
    expect(inbox.words[0].occurrences[0].sourceUrl).toBe('https://reader.example/article');
    expect(inbox.words[0].occurrences[0].sourceDomain).toBe('reader.example');
  });

  it('returns no-selection for empty pasted text', async () => {
    const result = await handleManualCapture('word', '   ');

    expect(result).toEqual({ ok: false, reason: 'no-selection' });
    expect((await getInbox()).words).toHaveLength(0);
  });
});

describe('toast injection', () => {
  it('injects renderCaptureToast on a successful keyboard capture', async () => {
    await handleCapture('word');
    const calls = (fakeBrowser.scripting.executeScript as any).mock.calls;
    const toastCall = calls.find((c: any[]) => c[0].func === renderCaptureToast);
    expect(toastCall).toBeTruthy();
    expect(toastCall[0].target).toEqual({ tabId: 1 });
    expect(Array.isArray(toastCall[0].args)).toBe(true);
  });

  it('still sets the badge and does not throw when toast injection fails', async () => {
    // First executeScript (readPageContext) succeeds; the toast injection rejects.
    (fakeBrowser.scripting.executeScript as any)
      .mockResolvedValueOnce([{ result: GOOD_CTX } as any])
      .mockRejectedValueOnce(new Error('restricted'));
    const result = await handleCapture('word');
    expect(result.ok).toBe(true);
    expect((await getInbox()).words).toHaveLength(1);
  });
});
