import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchClozeSuggestions } from '../lib/ai/client';

const VALID_BODY = JSON.stringify({ blanks: [{ answer: '刚需', reason: 'key' }] });
const VALID_COMPLETION = {
  ok: true as const,
  status: 200,
  json: async () => ({ choices: [{ message: { content: VALID_BODY } }] }),
} as unknown as Response;

describe('fetchClozeSuggestions', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('posts to /chat/completions with json_object and returns parsed suggestions', async () => {
    fetchSpy.mockResolvedValue(VALID_COMPLETION);
    const result = await fetchClozeSuggestions({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      provider: 'deepseek',
      quoteText: '满足人们的刚需',
    });
    expect(result).toEqual({ ok: true, suggestions: [{ answer: '刚需', reason: 'key' }] });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('maps HTTP errors via the existing classifier', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as unknown as Response);
    const result = await fetchClozeSuggestions({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'bad',
      model: 'deepseek-chat',
      provider: 'deepseek',
      quoteText: '你好',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('API key rejected');
  });

  it('returns a parse error when the body is not valid JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'oops' } }] }),
    } as unknown as Response);
    const result = await fetchClozeSuggestions({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk', model: 'deepseek-chat', provider: 'deepseek', quoteText: '你好',
    });
    expect(result.ok).toBe(false);
  });
});
