// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuoteCard } from '../entrypoints/dashboard/components/QuoteCard';
import { messages } from '../lib/i18n';
import type { QuoteEntry } from '../lib/types';

vi.mock('../lib/translate/google', () => ({
  fetchGoogleTranslation: vi.fn().mockResolvedValue({ ok: true, text: 'Learning is a joy' }),
}));
vi.mock('../lib/translate/permissions', () => ({
  GOOGLE_TRANSLATE_ORIGIN: 'https://translate.googleapis.com/*',
  requestGoogleTranslatePermission: vi.fn().mockResolvedValue(true),
  hasGoogleTranslatePermission: vi.fn().mockResolvedValue(true),
}));
vi.mock('../lib/ai/client', () => ({ fetchAiTranslation: vi.fn() }));
vi.mock('../lib/ai/settings', () => ({
  getAiSettings: vi.fn().mockResolvedValue({
    enabled: true,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-test',
    model: 'deepseek-v4-flash',
  }),
  isAiConfigured: vi.fn().mockReturnValue(true),
}));
vi.mock('../lib/storage', () => ({
  inboxStorage: { getValue: vi.fn().mockResolvedValue({ words: [], quotes: [] }) },
}));
vi.mock('../entrypoints/background/sync-mutation-handler', () => ({
  requestSyncMutation: vi.fn().mockResolvedValue(undefined),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
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

function queryButton(label: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(label),
    ) ?? null
  ) as HTMLButtonElement | null;
}

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

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

function card(quote: QuoteEntry) {
  return (
    <QuoteCard
      quote={quote}
      onUpdate={vi.fn()}
      onSetTags={vi.fn()}
      onDelete={vi.fn()}
      knownTags={[]}
      locale="en"
    />
  );
}

describe('QuoteCard translations', () => {
  it('renders both translate chips in the footer', async () => {
    await renderClient(card(makeQuote()));
    expect(queryButton(messages.en['translate.googleShort'])).not.toBeNull();
    expect(queryButton(messages.en['translate.aiShort'])).not.toBeNull();
  });

  it('renders a stored Google translation with its label', async () => {
    await renderClient(
      card(
        makeQuote({
          translations: { google: { text: 'Learning is a joy', generatedAt: 10 } },
        }),
      ),
    );
    // Hidden until toggled on: a stored translation starts collapsed.
    expect(container.textContent).not.toContain('Learning is a joy');
    await click(queryButton(messages.en['translate.googleShort'])!);
    expect(container.textContent).toContain(messages.en['translate.labelGoogle']);
    expect(container.textContent).toContain('Learning is a joy');
  });

  it('renders both stored translations independently', async () => {
    await renderClient(
      card(
        makeQuote({
          translations: {
            google: { text: 'Google version', generatedAt: 10 },
            ai: {
              text: 'AI version',
              generatedAt: 20,
              provider: 'deepseek',
              model: 'deepseek-v4-flash',
              baseUrl: 'https://api.deepseek.com',
            },
          },
        }),
      ),
    );

    await click(queryButton(messages.en['translate.googleShort'])!);
    expect(container.textContent).toContain('Google version');
    expect(container.textContent).not.toContain('AI version');

    await click(queryButton(messages.en['translate.aiShort'])!);
    expect(container.textContent).toContain('Google version');
    expect(container.textContent).toContain('AI version');
  });

  it('hides a shown translation when its chip is clicked again', async () => {
    await renderClient(
      card(
        makeQuote({
          translations: { google: { text: 'Learning is a joy', generatedAt: 10 } },
        }),
      ),
    );
    const chip = () => queryButton(messages.en['translate.googleShort'])!;
    await click(chip());
    expect(container.textContent).toContain('Learning is a joy');
    await click(chip());
    expect(container.textContent).not.toContain('Learning is a joy');
  });

  it('auto-shows a freshly generated Google translation', async () => {
    await renderClient(card(makeQuote()));
    await click(queryButton(messages.en['translate.googleShort'])!);
    // The parent re-renders with the persisted quote in the real app; here the
    // card must at least surface the newly fetched text from local state.
    expect(container.textContent).toContain('Learning is a joy');
  });

  it('still renders the Traditional chip alongside the translate chips', async () => {
    // TraditionalButton only renders the '繁' toggle once quote.traditionalText
    // exists; without it, it renders its "generate" mode instead (a different,
    // localized label). Supply traditionalText so this regression check
    // exercises the toggle mode the assertion targets.
    await renderClient(card(makeQuote({ traditionalText: '學而時習之' })));
    expect(queryButton('繁')).not.toBeNull();
  });
});
