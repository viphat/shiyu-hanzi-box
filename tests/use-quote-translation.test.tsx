// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuoteTranslation } from '../entrypoints/dashboard/hooks/useQuoteTranslation';
import type { QuoteEntry } from '../lib/types';

vi.mock('../lib/translate/google', () => ({
  fetchGoogleTranslation: vi.fn(),
}));
vi.mock('../lib/translate/permissions', () => ({
  GOOGLE_TRANSLATE_ORIGIN: 'https://translate.googleapis.com/*',
  requestGoogleTranslatePermission: vi.fn(),
  hasGoogleTranslatePermission: vi.fn(),
}));
vi.mock('../lib/ai/client', () => ({
  fetchAiTranslation: vi.fn(),
}));
vi.mock('../lib/ai/permissions', () => ({
  requestAiSettingsPermission: vi.fn(),
}));
vi.mock('../lib/ai/settings', () => ({
  getAiSettings: vi.fn(),
  isAiConfigured: vi.fn(),
}));
vi.mock('../entrypoints/background/sync-mutation-handler', () => ({
  requestSyncMutation: vi.fn(),
}));

const { fetchGoogleTranslation } = await import('../lib/translate/google');
const { requestGoogleTranslatePermission } = await import('../lib/translate/permissions');
const { fetchAiTranslation } = await import('../lib/ai/client');
const { requestAiSettingsPermission } = await import('../lib/ai/permissions');
const { getAiSettings, isAiConfigured } = await import('../lib/ai/settings');
const { requestSyncMutation } = await import('../entrypoints/background/sync-mutation-handler');

const AI_SETTINGS = {
  enabled: true,
  provider: 'deepseek' as const,
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test',
  model: 'deepseek-v4-flash',
};

function makeQuote(over: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '学而时习之',
    tags: [],
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    sourceTitle: 'Lunyu',
    sourceUrl: 'https://lunyu.com',
    sourceDomain: 'lunyu.com',
    surrounding: '不亦说乎',
    ...over,
  };
}

// A harness that surfaces the hook's return value to the test.
let api: ReturnType<typeof useQuoteTranslation>;

function Harness({ quote }: { quote: QuoteEntry }) {
  api = useQuoteTranslation(quote);
  return <div data-states={`${api.google.state}|${api.ai.state}`} />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  vi.mocked(getAiSettings).mockResolvedValue(AI_SETTINGS);
  vi.mocked(isAiConfigured).mockReturnValue(true);
  vi.mocked(requestGoogleTranslatePermission).mockResolvedValue(true);
  vi.mocked(requestAiSettingsPermission).mockResolvedValue(true);
  vi.mocked(requestSyncMutation).mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

async function renderClient(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

interface QuoteTranslationPatch {
  quoteId: string;
  slot: 'google' | 'ai';
  value: { text: string; generatedAt: number; provider?: string; model?: string; baseUrl?: string };
}

function lastMutationCall(): [string, QuoteTranslationPatch] {
  const calls = vi.mocked(requestSyncMutation).mock.calls;
  return calls[calls.length - 1] as [string, QuoteTranslationPatch];
}

describe('useQuoteTranslation — Google path', () => {
  it('requests the host permission, then persists the Google slot as a targeted patch', async () => {
    const quote = makeQuote();
    vi.mocked(fetchGoogleTranslation).mockResolvedValue({
      ok: true,
      text: 'Learning is a joy',
    });

    await renderClient(<Harness quote={quote} />);
    let returned: string | null = null;
    await act(async () => {
      returned = await api.translateGoogle();
    });

    expect(requestGoogleTranslatePermission).toHaveBeenCalledTimes(1);
    expect(fetchGoogleTranslation).toHaveBeenCalledWith({ text: '学而时习之' });
    expect(requestSyncMutation).toHaveBeenCalledTimes(1);
    const [kind, payload] = lastMutationCall();
    expect(kind).toBe('quoteTranslation');
    expect(payload.quoteId).toBe('q1');
    expect(payload.slot).toBe('google');
    expect(payload.value.text).toBe('Learning is a joy');
    expect(api.google.state).toBe('idle');
    expect(returned).toBe('Learning is a joy');
  });

  it('returns null when a request fails', async () => {
    vi.mocked(fetchGoogleTranslation).mockResolvedValue({ ok: false, code: 'unexpected' });

    await renderClient(<Harness quote={makeQuote()} />);
    let returned: string | null = 'unset';
    await act(async () => {
      returned = await api.translateGoogle();
    });

    expect(returned).toBeNull();
  });

  it('never calls fetch and reports permission-denied when the user declines', async () => {
    const quote = makeQuote();
    vi.mocked(requestGoogleTranslatePermission).mockResolvedValue(false);

    await renderClient(<Harness quote={quote} />);
    await act(async () => {
      await api.translateGoogle();
    });

    expect(fetchGoogleTranslation).not.toHaveBeenCalled();
    expect(requestSyncMutation).not.toHaveBeenCalled();
    expect(api.google.state).toBe('error');
    expect(api.google.failure).toBe('permission-denied');
  });

  it('writes nothing and surfaces the failure code when the request fails', async () => {
    const quote = makeQuote();
    vi.mocked(fetchGoogleTranslation).mockResolvedValue({
      ok: false,
      code: 'rate-limited',
    });

    await renderClient(<Harness quote={quote} />);
    await act(async () => {
      await api.translateGoogle();
    });

    expect(requestSyncMutation).not.toHaveBeenCalled();
    expect(api.google.state).toBe('error');
    expect(api.google.failure).toBe('rate-limited');
  });

  it('produces two separate targeted patches when both slots fire concurrently, neither carrying the other data', async () => {
    const quote = makeQuote();
    vi.mocked(fetchGoogleTranslation).mockResolvedValue({ ok: true, text: 'G text' });
    vi.mocked(fetchAiTranslation).mockResolvedValue({ ok: true, text: 'AI text' });

    await renderClient(<Harness quote={quote} />);
    await act(async () => {
      await Promise.all([api.translateGoogle(), api.translateAi()]);
    });

    expect(requestSyncMutation).toHaveBeenCalledTimes(2);
    const patches = vi.mocked(requestSyncMutation).mock.calls.map(
      ([, payload]) => payload as QuoteTranslationPatch,
    );

    const googlePatch = patches.find((p) => p.slot === 'google')!;
    const aiPatch = patches.find((p) => p.slot === 'ai')!;

    expect(googlePatch).toBeDefined();
    expect(aiPatch).toBeDefined();
    expect(googlePatch.value.text).toBe('G text');
    expect(aiPatch.value.text).toBe('AI text');
    // Each patch carries only its own slot's value — no sibling data at all,
    // since the merge now happens atomically in the background chain, not here.
    expect(googlePatch.value).not.toHaveProperty('provider');
    expect(aiPatch.quoteId).toBe(googlePatch.quoteId);
  });
});

describe('useQuoteTranslation — AI path', () => {
  it('persists the AI slot with provider provenance as a targeted patch', async () => {
    const quote = makeQuote();
    vi.mocked(fetchAiTranslation).mockResolvedValue({
      ok: true,
      text: 'Nature shows no favour',
    });

    await renderClient(<Harness quote={quote} />);
    let returned: string | null = null;
    await act(async () => {
      returned = await api.translateAi();
    });

    expect(returned).toBe('Nature shows no favour');
    const [kind, payload] = lastMutationCall();
    expect(kind).toBe('quoteTranslation');
    expect(payload.quoteId).toBe('q1');
    expect(payload.slot).toBe('ai');
    expect(payload.value.text).toBe('Nature shows no favour');
    expect(payload.value.provider).toBe('deepseek');
    expect(payload.value.model).toBe('deepseek-v4-flash');
    expect(payload.value.baseUrl).toBe('https://api.deepseek.com');
    expect(requestGoogleTranslatePermission).not.toHaveBeenCalled();
  });

  it('starts disabled with not-configured when AI is unconfigured', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(false);

    await renderClient(<Harness quote={makeQuote()} />);

    expect(api.ai.state).toBe('disabled');
    expect(api.ai.failure).toBe('not-configured');
    expect(api.google.state).toBe('idle');
  });

  it('does not call the provider when AI is unconfigured', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(false);

    await renderClient(<Harness quote={makeQuote()} />);
    await act(async () => {
      await api.translateAi();
    });

    expect(fetchAiTranslation).not.toHaveBeenCalled();
    expect(requestSyncMutation).not.toHaveBeenCalled();
  });

  it('keeps the failure detail from the provider', async () => {
    vi.mocked(fetchAiTranslation).mockResolvedValue({
      ok: false,
      code: 'unreachable',
      detail: 'upstream down',
    });

    await renderClient(<Harness quote={makeQuote()} />);
    await act(async () => {
      await api.translateAi();
    });

    expect(api.ai.state).toBe('error');
    expect(api.ai.failure).toBe('unreachable');
    expect(api.ai.detail).toBe('upstream down');
  });

  it('never calls fetch and reports permission-denied when the AI provider permission is declined', async () => {
    vi.mocked(requestAiSettingsPermission).mockResolvedValue(false);

    await renderClient(<Harness quote={makeQuote()} />);
    await act(async () => {
      await api.translateAi();
    });

    expect(fetchAiTranslation).not.toHaveBeenCalled();
    expect(requestSyncMutation).not.toHaveBeenCalled();
    expect(api.ai.state).toBe('error');
    expect(api.ai.failure).toBe('permission-denied');
  });

  it('leaves the Google slot idle when the AI path fails', async () => {
    vi.mocked(fetchAiTranslation).mockResolvedValue({ ok: false, code: 'unexpected' });

    await renderClient(<Harness quote={makeQuote()} />);
    await act(async () => {
      await api.translateAi();
    });

    expect(api.ai.state).toBe('error');
    expect(api.google.state).toBe('idle');
  });
});
