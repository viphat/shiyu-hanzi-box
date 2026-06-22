import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAiInsight, testAiConnection } from '../lib/ai/client';

const VALID_RESPONSE_BODY = JSON.stringify({
  summary: 'hello',
  register: 'neutral',
  definitions: ['打招呼 - hello'],
  sampleSentences: ['你好。'],
  translations: ['Hello.'],
  collocations: [],
  notes: '',
});

const VALID_COMPLETION = {
  ok: true as const,
  status: 200,
  json: async () => ({
    choices: [{ message: { content: VALID_RESPONSE_BODY } }],
  }),
} as unknown as Response;

describe('fetchAiInsight', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls fetch with the correct URL, headers, body, and response_format', async () => {
    fetchSpy.mockResolvedValue(VALID_COMPLETION);

    await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: '你好' }],
      provider: 'deepseek',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('includes response_format json_object in the body', async () => {
    fetchSpy.mockResolvedValue(VALID_COMPLETION);

    await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'test' }],
      provider: 'deepseek',
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.messages).toEqual([{ role: 'user', content: 'test' }]);
  });

  it('normalizes DeepSeek model version names to API model ids', async () => {
    fetchSpy.mockResolvedValue(VALID_COMPLETION);

    await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'DeepSeek-V4-Flash',
      messages: [{ role: 'user', content: 'test' }],
      provider: 'deepseek',
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.model).toBe('deepseek-v4-flash');
  });

  it('returns the parsed AiInsight on success', async () => {
    fetchSpy.mockResolvedValue(VALID_COMPLETION);

    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'test' }],
      provider: 'deepseek',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe('hello');
  });

  it('returns a "key rejected" error on 401/403', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);

    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-bad',
      model: 'm',
      messages: [],
      provider: 'deepseek',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('key rejected');
  });

  it('returns a "rate limited" error on 429', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) } as Response);

    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk',
      model: 'm',
      messages: [],
      provider: 'deepseek',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('Rate limited');
  });

  it('includes provider error messages for non-auth request failures', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Model Not Exist' } }),
    } as Response);

    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk',
      model: 'DeepSeek-V4-Flash',
      messages: [],
      provider: 'deepseek',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('HTTP 400');
    expect(result.reason).toContain('Model Not Exist');
  });

  it('returns an "unreachable" error on 5xx', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) } as Response);

    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk',
      model: 'm',
      messages: [],
      provider: 'deepseek',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('unreachable');
  });

  it('returns an "unreachable" error on network failure', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk',
      model: 'm',
      messages: [],
      provider: 'deepseek',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('unreachable');
  });

  it('returns a "parse error" when the model returns bad JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    } as unknown as Response);

    const result = await fetchAiInsight({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk',
      model: 'm',
      messages: [],
      provider: 'deepseek',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('Unexpected');
  });
});

describe('testAiConnection', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('succeeds for valid JSON without requiring the full insight schema', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
    } as unknown as Response);

    const result = await testAiConnection({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'DeepSeek-V4-Flash',
      provider: 'deepseek',
    });

    expect(result).toEqual({ ok: true, message: '连接成功' });
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('returns schema-oriented feedback only when the provider content is not JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'hello' } }],
      }),
    } as unknown as Response);

    const result = await testAiConnection({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('valid JSON');
  });
});
