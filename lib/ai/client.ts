import type { AiInsight, AiProvider } from '../types';
import { parseAiResponse } from './parse';
import type { AiMessage } from './prompt';
import { buildClozeMessages } from './cloze-prompt';
import { parseClozeSuggestions, type ClozeSuggestion } from './cloze-parse';

export interface FetchAiParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: AiMessage[];
  provider: AiProvider;
}

export interface TestAiConnectionParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: AiProvider;
}

export type AiClientResult =
  | { ok: true; value: AiInsight }
  | { ok: false; reason: string };

function classifyHttpStatus(status: number): string | null {
  if (status === 401 || status === 403) return 'API key rejected by provider.';
  if (status === 429) return 'Rate limited; wait and retry.';
  if (status >= 500) return 'Provider unreachable; retry.';
  if (status < 200 || status >= 300) return `Provider request failed with HTTP ${status}.`;
  return null;
}

function completionUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function requestModel(provider: AiProvider, model: string): string {
  const trimmed = model.trim();
  return provider === 'deepseek' ? trimmed.toLowerCase() : trimmed;
}

async function providerErrorMessage(response: Response): Promise<string | null> {
  try {
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message;
      return typeof message === 'string' && message.trim() !== '' ? message : null;
    }
    const message = record.message;
    return typeof message === 'string' && message.trim() !== '' ? message : null;
  } catch {
    return null;
  }
}

async function postChatCompletion(
  params: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: AiMessage[];
    provider: AiProvider;
    maxTokens?: number;
  },
): Promise<
  | { ok: true; content: string; modelId: string }
  | { ok: false; reason: string }
> {
  const modelId = requestModel(params.provider, params.model);
  const response = await fetch(completionUrl(params.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: params.messages,
      response_format: { type: 'json_object' },
      max_tokens: params.maxTokens ?? 1200,
    }),
  });

  const httpError = classifyHttpStatus(response.status);
  if (httpError) {
    const detail = await providerErrorMessage(response);
    return { ok: false, reason: detail ? `${httpError} ${detail}` : httpError };
  }

  const data = await response.json();
  const content: unknown = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return { ok: false, reason: 'Unexpected response: no message content.' };
  }

  return { ok: true, content, modelId };
}

export async function fetchAiInsight(params: FetchAiParams): Promise<AiClientResult> {
  try {
    const result = await postChatCompletion(params);
    if (!result.ok) {
      return result;
    }

    const parsed = parseAiResponse(result.content, params.provider, result.modelId, params.baseUrl);
    if (!parsed.ok) {
      return { ok: false, reason: `Unexpected response; ${parsed.reason}` };
    }

    return parsed;
  } catch {
    return { ok: false, reason: 'Provider unreachable; retry.' };
  }
}

export async function fetchClozeSuggestions(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: AiProvider;
  quoteText: string;
}): Promise<
  | { ok: true; suggestions: ClozeSuggestion[] }
  | { ok: false; reason: string }
> {
  try {
    const result = await postChatCompletion({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      provider: params.provider,
      messages: buildClozeMessages(params.quoteText),
      maxTokens: 400,
    });
    if (!result.ok) return result;
    return parseClozeSuggestions(result.content);
  } catch {
    return { ok: false, reason: 'Provider unreachable; retry.' };
  }
}

export async function testAiConnection(
  params: TestAiConnectionParams,
): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await postChatCompletion({
      ...params,
      messages: [
        {
          role: 'system',
          content: 'Return valid JSON only. Example JSON output: {"ok":true}',
        },
        {
          role: 'user',
          content: 'Connection test. Return {"ok":true} as JSON.',
        },
      ],
    });
    if (!result.ok) return { ok: false, message: result.reason };

    try {
      const parsed: unknown = JSON.parse(result.content);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return { ok: true, message: '连接成功' };
      }
      return { ok: false, message: 'Unexpected response: response is not a JSON object.' };
    } catch {
      return { ok: false, message: 'Unexpected response: response is not valid JSON.' };
    }
  } catch {
    return { ok: false, message: 'Provider unreachable; retry.' };
  }
}
