// @vitest-environment happy-dom

import { fakeBrowser } from '@webext-core/fake-browser';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '../entrypoints/dashboard/hooks/useSettings';
import { getSettings, replaceSettings } from '../lib/settings';
import type { AppSettings } from '../lib/types';

vi.mock('../lib/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/settings')>();
  return { ...actual, getSettings: vi.fn(actual.getSettings) };
});

let container: HTMLDivElement;
let root: Root;

function Probe({ onRender }: { onRender: (state: ReturnType<typeof useSettings>) => void }) {
  onRender(useSettings());
  return null;
}

beforeEach(() => {
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

describe('useSettings', () => {
  it('loads the persisted settings', async () => {
    await replaceSettings({ ...(await getSettings()), uiLocale: 'en' });

    let latest: ReturnType<typeof useSettings> | null = null;
    await act(async () => {
      root.render(<Probe onRender={(state) => { latest = state; }} />);
    });

    expect(latest!.loading).toBe(false);
    expect(latest!.settings.uiLocale).toBe('en');
  });

  it('picks up an external write via the storage watcher', async () => {
    let latest: ReturnType<typeof useSettings> | null = null;
    await act(async () => {
      root.render(<Probe onRender={(state) => { latest = state; }} />);
    });

    await act(async () => {
      await replaceSettings({ ...(await getSettings()), uiLocale: 'en' });
    });

    expect(latest!.settings.uiLocale).toBe('en');
  });

  it('does not let a slow initial read clobber a fresher value the watcher already delivered', async () => {
    // Seed a value that will still be sitting in storage when the (mocked,
    // deliberately slow) initial getSettings() call for this mount
    // eventually resolves.
    await replaceSettings({ ...(await getSettings()), uiLocale: 'zh-CN' });

    let resolveInitial!: (value: AppSettings) => void;
    const deferredInitialRead = new Promise<AppSettings>((resolve) => {
      resolveInitial = resolve;
    });
    const staleSnapshot = await getSettings();
    vi.mocked(getSettings).mockReturnValueOnce(deferredInitialRead);

    let latest: ReturnType<typeof useSettings> | null = null;
    await act(async () => {
      root.render(<Probe onRender={(state) => { latest = state; }} />);
    });
    // The mocked initial read is still pending, so the hook has not applied
    // anything yet.
    expect(latest!.loading).toBe(true);

    // A write from elsewhere lands, and its storage-watcher event is
    // delivered before the slow initial read resolves — the race this
    // guards against.
    await act(async () => {
      await replaceSettings({ ...staleSnapshot, uiLocale: 'en' });
    });
    expect(latest!.settings.uiLocale).toBe('en');
    expect(latest!.loading).toBe(false);

    // Now let the stale initial read resolve. Without the fix, this
    // overwrites the fresher, watcher-delivered value with the stale one
    // captured before the watcher fired.
    await act(async () => {
      resolveInitial(staleSnapshot);
    });
    expect(latest!.settings.uiLocale).toBe('en');
    expect(latest!.loading).toBe(false);
  });
});
