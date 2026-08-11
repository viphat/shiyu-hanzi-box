// @vitest-environment happy-dom

import { fakeBrowser } from '@webext-core/fake-browser';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDrift } from '../entrypoints/dashboard/hooks/useDrift';
import { nudgeLevel } from '../lib/drift';
import { replaceDriftStore } from '../lib/drift-storage';

let container: HTMLDivElement;
let root: Root;

function Probe({ onRender }: { onRender: (state: ReturnType<typeof useDrift>) => void }) {
  onRender(useDrift());
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

describe('useDrift', () => {
  it('loads the persisted store', async () => {
    await replaceDriftStore({ weights: { '你好': 2 }, days: {} });

    let latest: ReturnType<typeof useDrift> | null = null;
    await act(async () => {
      root.render(<Probe onRender={(state) => { latest = state; }} />);
    });

    expect(latest!.loading).toBe(false);
    expect(latest!.driftStore.weights).toEqual({ '你好': 2 });
  });

  it('writes a mutation through to storage', async () => {
    let latest: ReturnType<typeof useDrift> | null = null;
    await act(async () => {
      root.render(<Probe onRender={(state) => { latest = state; }} />);
    });

    await act(async () => {
      await latest!.mutateDrift((store) => nudgeLevel(store, '你好', 1));
    });

    expect(latest!.driftStore.weights).toEqual({ '你好': 1 });
  });

  it('picks up an external write via the storage watcher', async () => {
    let latest: ReturnType<typeof useDrift> | null = null;
    await act(async () => {
      root.render(<Probe onRender={(state) => { latest = state; }} />);
    });

    await act(async () => {
      await replaceDriftStore({ weights: {}, days: { '2026-08-11': 3 } });
    });

    expect(latest!.driftStore.days).toEqual({ '2026-08-11': 3 });
  });
});
