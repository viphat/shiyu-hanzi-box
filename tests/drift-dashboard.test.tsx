// @vitest-environment happy-dom

import { fakeBrowser } from '@webext-core/fake-browser';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../entrypoints/dashboard/App';
import { registerSyncMutationHandler } from '../entrypoints/background/sync-mutation-handler';
import { serializeFullBackup } from '../lib/backup';
import { getAiSettings } from '../lib/ai/settings';
import type { DriftStore } from '../lib/drift';
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

describe('drift through a full backup restore (dashboard wiring)', () => {
  it('writes the restored drift store to disk when a backup is restored via the Toolbar', async () => {
    // requestSyncMutation('settings', ...) is on this path too (App.onRestore
    // always forwards restored.settings, since serializeFullBackup always
    // includes them) — fake-browser has no background context to answer that
    // message without a registered handler.
    registerSyncMutationHandler();

    await setInbox({ words: [word()], quotes: [] });
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en' });
    await renderApp();

    const restoredDrift: DriftStore = {
      weights: { 'word:你好': 2, 'quote:q1': -1 },
      days: { '2026-08-01': 3, '2026-08-02': 1 },
    };
    const backupJson = serializeFullBackup(
      { words: [word()], quotes: [] },
      await getSettings(),
      await getAiSettings(),
      restoredDrift,
    );

    // The restore path gates on window.confirm before calling onRestore.
    // happy-dom may not define window.confirm — ensure it exists before spying.
    if (!window.confirm) window.confirm = () => false;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    // Drive the *actual* file input Toolbar renders, rather than calling
    // onRestore directly — that's the only way to exercise the wiring in
    // entrypoints/dashboard/App.tsx that persists the restored drift store.
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const file = new File([backupJson], 'backup.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });

    await act(async () => {
      fileInput!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // restoreBackup awaits file.text() and restoreFullBackup before calling
    // onRestore, so give the microtask queue an extra couple of turns to
    // settle before asserting on storage.
    await act(async () => {});
    await act(async () => {});

    expect(confirmSpy).toHaveBeenCalled();
    expect(await getDriftStore()).toEqual(restoredDrift);

    confirmSpy.mockRestore();
  });
});
