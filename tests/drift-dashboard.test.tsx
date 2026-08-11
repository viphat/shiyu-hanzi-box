// @vitest-environment happy-dom

import { fakeBrowser } from '@webext-core/fake-browser';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../entrypoints/dashboard/App';
import { getDriftStore } from '../lib/drift-storage';
import { messages } from '../lib/i18n';
import { setInbox } from '../lib/storage';
import { getSettings, replaceSettings } from '../lib/settings';
import type { WordEntry } from '../lib/types';

function word(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'w1',
    kind: 'word',
    text: '你好',
    normalized: '你好',
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    occurrences: [],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fakeBrowser.reset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderApp() {
  await act(async () => {
    root.render(<App />);
  });
  // Let the storage-backed hooks settle.
  await act(async () => {});
}

describe('drift mode in the dashboard', () => {
  it('renders the SRS queue by default', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en' });
    await renderApp();
    expect(container.querySelector('[data-testid="drift-up"]')).toBeNull();
  });

  it('renders drift in the review tab when selected', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en', reviewMode: 'drift' });
    await renderApp();
    expect(container.querySelector('[data-testid="drift-up"]')).not.toBeNull();
  });

  it('persists a thumb-up to the drift store', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en', reviewMode: 'drift' });
    await renderApp();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="drift-up"]')!.click();
    });
    await act(async () => {});

    // driftKey namespaces word entries as `word:<normalized>` (see lib/drift.ts)
    // so weights don't collide with quote keys sharing the same text.
    expect((await getDriftStore()).weights['word:你好']).toBe(1);
  });

  it('never writes FSRS state when drifting', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en', reviewMode: 'drift' });
    await renderApp();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="drift-up"]')!.click();
    });
    await act(async () => {});

    const { getInbox } = await import('../lib/storage');
    expect((await getInbox()).words[0].review).toBeUndefined();
  });

  it('counts a skip toward today without changing any weight', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en', reviewMode: 'drift' });
    await renderApp();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="drift-skip"]')!.click();
    });
    await act(async () => {});

    const store = await getDriftStore();
    expect(store.weights).toEqual({});
    expect(Object.values(store.days)).toEqual([1]);
  });

  it('shows the drift label on the review tab', async () => {
    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en', reviewMode: 'drift' });
    await renderApp();
    expect(container.textContent).toContain(messages.en['drift.title']);
  });
});
