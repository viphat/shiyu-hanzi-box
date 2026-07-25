import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import { fetchGoogleTranslation } from '../lib/translate/google';
import {
  GOOGLE_TRANSLATE_ORIGIN,
  hasGoogleTranslatePermission,
  requestGoogleTranslatePermission,
} from '../lib/translate/permissions';

function gtxResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const OK_BODY = [[['Learning is a joy', '学而时习之', null, null, 3]], null, 'zh-CN'];

describe('fetchGoogleTranslation', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the gtx URL with encoded query text and zh-CN to en', async () => {
    fetchSpy.mockResolvedValue(gtxResponse(OK_BODY));

    await fetchGoogleTranslation({ text: '学而时习之' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url.startsWith('https://translate.googleapis.com/translate_a/single?')).toBe(true);
    expect(url).toContain('client=gtx');
    expect(url).toContain('sl=zh-CN');
    expect(url).toContain('tl=en');
    expect(url).toContain('dt=t');
    expect(url).toContain(`q=${encodeURIComponent('学而时习之')}`);
  });

  it('returns the parsed translation on success', async () => {
    fetchSpy.mockResolvedValue(gtxResponse(OK_BODY));
    await expect(fetchGoogleTranslation({ text: '学而时习之' })).resolves.toEqual({
      ok: true,
      text: 'Learning is a joy',
    });
  });

  it('maps HTTP 429 to rate-limited', async () => {
    fetchSpy.mockResolvedValue(gtxResponse(null, 429));
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'rate-limited',
    });
  });

  it('maps HTTP 500 to unreachable', async () => {
    fetchSpy.mockResolvedValue(gtxResponse(null, 503));
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'unreachable',
    });
  });

  it('maps other non-2xx statuses to unexpected', async () => {
    fetchSpy.mockResolvedValue(gtxResponse(null, 404));
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('maps a network rejection to unreachable', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'unreachable',
    });
  });

  it('maps a body that fails JSON parsing to unexpected', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    } as unknown as Response);
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('propagates the parser failure code for a malformed body', async () => {
    fetchSpy.mockResolvedValue(gtxResponse({ nope: true }));
    await expect(fetchGoogleTranslation({ text: '你好' })).resolves.toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('short-circuits blank input without any fetch', async () => {
    await expect(fetchGoogleTranslation({ text: '   ' })).resolves.toEqual({
      ok: false,
      code: 'empty',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Google Translate host permission', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests exactly the translate.googleapis.com origin', async () => {
    const spy = vi
      .spyOn(fakeBrowser.permissions, 'request')
      .mockResolvedValue(true);

    await expect(requestGoogleTranslatePermission()).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith({ origins: [GOOGLE_TRANSLATE_ORIGIN] });
  });

  it('returns false when the user denies the request', async () => {
    vi.spyOn(fakeBrowser.permissions, 'request').mockResolvedValue(false);
    await expect(requestGoogleTranslatePermission()).resolves.toBe(false);
  });

  it('returns false when the permissions API throws', async () => {
    vi.spyOn(fakeBrowser.permissions, 'request').mockRejectedValue(new Error('no gesture'));
    await expect(requestGoogleTranslatePermission()).resolves.toBe(false);
  });

  it('reports whether the origin is already granted', async () => {
    vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(true);
    await expect(hasGoogleTranslatePermission()).resolves.toBe(true);
  });

  it('reports false when the contains check throws', async () => {
    vi.spyOn(fakeBrowser.permissions, 'contains').mockRejectedValue(new Error('boom'));
    await expect(hasGoogleTranslatePermission()).resolves.toBe(false);
  });
});
