import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAiTranslation } from '../lib/ai/client';

function completion(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

function errorResponse(status: number, message?: string): Response {
  return {
    ok: false,
    status,
    json: async () => (message ? { error: { message } } : {}),
  } as unknown as Response;
}

const PARAMS = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test',
  model: 'deepseek-v4-flash',
  provider: 'deepseek' as const,
  quoteText: '学而时习之',
};

describe('fetchAiTranslation', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to the chat completions endpoint and returns the translation', async () => {
    fetchSpy.mockResolvedValue(completion('{"translation":"Learning is a joy"}'));

    await expect(fetchAiTranslation(PARAMS)).resolves.toEqual({
      ok: true,
      text: 'Learning is a joy',
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.max_tokens).toBe(400);
    expect(JSON.stringify(body.messages)).toContain('学而时习之');
  });

  it('maps a 5xx provider status to unreachable and keeps the provider detail', async () => {
    fetchSpy.mockResolvedValue(errorResponse(503, 'upstream down'));

    const result = await fetchAiTranslation(PARAMS);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('unreachable');
    expect(result.detail).toContain('upstream down');
  });

  it('maps a rejected API key to unexpected and keeps the provider detail', async () => {
    fetchSpy.mockResolvedValue(errorResponse(401, 'bad key'));

    const result = await fetchAiTranslation(PARAMS);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('unexpected');
    expect(result.detail).toContain('bad key');
  });

  it('maps a 429 provider status to rate-limited and keeps the provider detail', async () => {
    fetchSpy.mockResolvedValue(errorResponse(429, 'slow down'));

    const result = await fetchAiTranslation(PARAMS);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('rate-limited');
    expect(result.detail).toContain('slow down');
  });

  it('maps a network rejection to unreachable', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchAiTranslation(PARAMS)).resolves.toEqual({
      ok: false,
      code: 'unreachable',
    });
  });

  it('maps an unparseable model reply to unexpected', async () => {
    fetchSpy.mockResolvedValue(completion('I cannot do that'));
    await expect(fetchAiTranslation(PARAMS)).resolves.toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('short-circuits blank quote text without any fetch', async () => {
    await expect(fetchAiTranslation({ ...PARAMS, quoteText: '  ' })).resolves.toEqual({
      ok: false,
      code: 'empty',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
