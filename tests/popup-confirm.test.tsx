// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../lib/i18n';

const { undoCapture, handleManualCapture, handleCapture } = vi.hoisted(() => ({
  undoCapture: vi.fn().mockResolvedValue(undefined),
  handleManualCapture: vi.fn(),
  handleCapture: vi.fn(),
}));

vi.mock('@/entrypoints/background/capture-undo', () => ({ undoCapture }));
vi.mock('@/entrypoints/background/capture-handler', () => ({
  handleManualCapture,
  handleCapture,
}));
vi.mock('@/lib/settings', () => ({
  getSettings: () => Promise.resolve({ uiLocale: 'en' }),
  watchSettings: () => () => {},
}));

import { Popup } from '../entrypoints/popup/Popup';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
});

/** Find a rendered <button> whose text contains `label`. */
function findButton(label: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').includes(label),
  );
  if (!btn) throw new Error(`button not found: ${label}`);
  return btn as HTMLButtonElement;
}

describe('popup capture confirmation', () => {
  it('shows the headline + captured text + Undo, and calls undoCapture on click', async () => {
    const undo = {
      type: 'undo-capture', kind: 'word', action: 'created',
      entryId: 'w1', normalized: '你好',
    };
    // The top "Save as word" button calls go() -> handleCapture().
    handleCapture.mockResolvedValue({
      ok: true,
      outcome: { kind: 'word', action: 'created', entry: { id: 'w1', text: '你好' } },
      undo,
    });

    await act(async () => { root.render(<Popup />); });
    await act(async () => {}); // flush the settings effect -> locale 'en'

    await act(async () => { findButton(messages.en['popup.saveWord']).click(); });

    // Confirmation surface: headline + captured text + Undo button.
    expect(container.textContent).toContain(messages.en['toast.savedWord']);
    expect(container.textContent).toContain('你好');
    const undoBtn = findButton(messages.en['toast.undo']);

    // Undo routes to the shared undoCapture with the exact undo message.
    await act(async () => { undoBtn.click(); });
    expect(undoCapture).toHaveBeenCalledWith(undo);
  });

  it('renders no Undo affordance for a duplicate (undo === null)', async () => {
    handleCapture.mockResolvedValue({
      ok: true,
      outcome: { kind: 'quote', action: 'duplicate', entry: { id: 'q1', text: '学而时习之' } },
      undo: null,
    });

    await act(async () => { root.render(<Popup />); });
    await act(async () => {});
    await act(async () => { findButton(messages.en['popup.saveWord']).click(); });

    expect(container.textContent).toContain(messages.en['toast.duplicate']);
    const undoBtn = [...container.querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').includes(messages.en['toast.undo']),
    );
    expect(undoBtn).toBeUndefined();
  });
});
