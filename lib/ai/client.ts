import type { AiInsight, AiProvider } from '../types';
import { parseAiResponse } from './parse';
import type { AiMessage } from './prompt';

export interface FetchAiParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: AiMessage[];
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

export async function fetchAiInsight(params: FetchAiParams): Promise<AiClientResult> {
  const { baseUrl, apiKey, model, messages, provider } = params;

  try {
    const response = await fetch(completionUrl(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
      }),
    });

    const httpError = classifyHttpStatus(response.status);
    if (httpError) return { ok: false, reason: httpError };

    const data = await response.json();
    const content: unknown = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return { ok: false, reason: 'Unexpected response: no message content.' };
    }

    const parsed = parseAiResponse(content, provider, model, baseUrl);
    if (!parsed.ok) {
      return { ok: false, reason: `Unexpected response; ${parsed.reason}` };
    }

    return parsed;
  } catch {
    return { ok: false, reason: 'Provider unreachable; retry.' };
  }
}
