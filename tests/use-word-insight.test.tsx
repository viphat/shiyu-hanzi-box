// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, WordEntry } from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/settings';

const loaderMocks = vi.hoisted(() => ({
  loadDictionary: vi.fn(),
}));

vi.mock('@/lib/dictionary-loader', () => loaderMocks);

import { useWordInsight } from '../entrypoints/dashboard/hooks/useWordInsight';

const word: WordEntry = {
  id: 'word-1',
  kind: 'word',
  text: '你好',
  normalized: '你好',
  note: '',
  status: 'inbox',
  createdAt: 1,
  updatedAt: 1,
  occurrences: [],
};

const settingsA: AppSettings = {
  ...DEFAULT_SETTINGS,
  kaikki: { ...DEFAULT_SETTINGS.kaikki, enabled: true, hash: 'kaikki-a' },
  cvdict: { ...DEFAULT_SETTINGS.cvdict, enabled: true, hash: 'cvdict-a' },
};

const settingsB: AppSettings = {
  ...DEFAULT_SETTINGS,
  kaikki: { ...DEFAULT_SETTINGS.kaikki, enabled: true, hash: 'kaikki-b' },
  cvdict: { ...DEFAULT_SETTINGS.cvdict, enabled: true, hash: 'cvdict-b' },
};

let container: HTMLDivElement;
let root: Root;

function Harness({ cacheKey, settings }: { cacheKey: string; settings: AppSettings }) {
  const { loading } = useWordInsight(word, cacheKey, settings);
  return <span data-testid="loading">{String(loading)}</span>;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  loaderMocks.loadDictionary.mockReset();
  loaderMocks.loadDictionary.mockResolvedValue({
    indexes: { english: null, vietnamese: null },
    cvdictEnabled: false,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function render(cacheKey: string, settings: AppSettings) {
  await act(async () => {
    root.render(<Harness cacheKey={cacheKey} settings={settings} />);
  });
  await act(async () => {});
}

describe('useWordInsight dictionary session cache', () => {
  it('keeps each cache key associated with its settings snapshot', async () => {
    await render('kaikki-a:cvdict-a', settingsA);
    await render('kaikki-b:cvdict-b', settingsB);
    await render('kaikki-a:cvdict-a', settingsA);

    expect(loaderMocks.loadDictionary).toHaveBeenNthCalledWith(1, settingsA);
    expect(loaderMocks.loadDictionary).toHaveBeenNthCalledWith(2, settingsB);
    expect(loaderMocks.loadDictionary).toHaveBeenCalledTimes(2);
  });
});
