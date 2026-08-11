// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriftView } from '../entrypoints/dashboard/components/DriftView';
import { EMPTY_DRIFT_STORE } from '../lib/drift';
import { messages } from '../lib/i18n';
import type { Inbox, QuoteEntry, WordEntry } from '../lib/types';

const NOW = new Date('2026-08-11T10:00:00').getTime();

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

function quote(overrides: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '学而时习之',
    tags: ['论语'],
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    sourceTitle: 'Analects',
    sourceUrl: 'https://example.com/a',
    sourceDomain: 'example.com',
    surrounding: '',
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function render(inbox: Inbox, handlers: Record<string, unknown> = {}) {
  act(() => {
    root.render(
      <DriftView
        inbox={inbox}
        store={EMPTY_DRIFT_STORE}
        onThumb={() => {}}
        onSkip={() => {}}
        onBack={() => {}}
        locale="en"
        random={() => 0}
        now={() => NOW}
        {...handlers}
      />,
    );
  });
}

function click(testId: string) {
  act(() => {
    container
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('DriftView', () => {
  it('shows the empty state when nothing is collectable', () => {
    render({ words: [], quotes: [] });
    expect(container.textContent).toContain(messages.en['drift.emptyTitle']);
  });

  it('excludes archived entries from the pool', () => {
    render({ words: [word({ status: 'archived' })], quotes: [] });
    expect(container.textContent).toContain(messages.en['drift.emptyTitle']);
  });

  it('shows a parked quote, which SRS can never surface', () => {
    render({ words: [], quotes: [quote({ clozes: [] })] });
    expect(container.textContent).toContain('学而时习之');
  });

  it('renders a quote with no cloze blanks', () => {
    render({
      words: [],
      quotes: [quote({ clozes: [{ id: 'c1', start: 0, end: 2 }] })],
    });
    // The full sentence, not a blanked one.
    expect(container.textContent).toContain('学而时习之');
    expect(container.textContent).not.toContain('____');
  });

  it('offers all three controls plus back', () => {
    render({ words: [word()], quotes: [] });
    for (const id of ['drift-down', 'drift-skip', 'drift-up']) {
      expect(container.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
  });

  it('reports a thumb-up with its previous level and local day', () => {
    const onThumb = vi.fn();
    render({ words: [word()], quotes: [] }, { onThumb });
    click('drift-up');
    expect(onThumb).toHaveBeenCalledWith(
      expect.objectContaining({ normalized: '你好' }),
      1,
      0,
      '2026-08-11',
    );
  });

  it('reports a thumb-down as delta -1', () => {
    const onThumb = vi.fn();
    render({ words: [word()], quotes: [] }, { onThumb });
    click('drift-down');
    expect(onThumb).toHaveBeenCalledWith(expect.anything(), -1, 0, '2026-08-11');
  });

  it('records a skip without a weight change', () => {
    const onSkip = vi.fn();
    const onThumb = vi.fn();
    render({ words: [word()], quotes: [] }, { onSkip, onThumb });
    click('drift-skip');
    expect(onSkip).toHaveBeenCalledWith('2026-08-11');
    expect(onThumb).not.toHaveBeenCalled();
  });

  it('advances to a different card after a thumb', () => {
    // Distinct text per word — two entries both reading 你好 would make this
    // assertion pass or fail for the wrong reason.
    render({ words: [word({ id: 'wa', normalized: 'a', text: '甲' }), word({ id: 'wb', normalized: 'b', text: '乙' })], quotes: [] });
    expect(container.querySelector('[data-testid="drift-text"]')!.textContent).toBe('甲');
    click('drift-up');
    expect(container.querySelector('[data-testid="drift-text"]')!.textContent).toBe('乙');
  });

  it('hides Back on the first card', () => {
    render({ words: [word()], quotes: [] });
    expect(container.querySelector('[data-testid="drift-back"]')).toBeNull();
  });

  it('returns to the previous card and reports the level to restore', () => {
    const onBack = vi.fn();
    render(
      { words: [word({ id: 'wa', normalized: 'a', text: '甲' }), word({ id: 'wb', normalized: 'b', text: '乙' })], quotes: [] },
      { onBack },
    );
    click('drift-up');
    click('drift-back');
    expect(container.querySelector('[data-testid="drift-text"]')!.textContent).toBe('甲');
    expect(onBack).toHaveBeenCalledWith(expect.anything(), 0, '2026-08-11');
  });

  it('renders a five-dot weight scale', () => {
    render({ words: [word()], quotes: [] });
    expect(container.querySelectorAll('[data-testid="drift-dot"]')).toHaveLength(5);
  });
});
