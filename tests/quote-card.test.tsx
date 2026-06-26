// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuoteCard } from '../entrypoints/dashboard/components/QuoteCard';
import { messages } from '../lib/i18n';
import type { Cloze, QuoteEntry, WordEntry } from '../lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWord(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'w1',
    kind: 'word',
    text: '学而',
    normalized: '学而',
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    occurrences: [],
    ...overrides,
  };
}

function makeQuote(overrides: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '学而时习之',
    tags: [],
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    category: 'classic',
    sourceTitle: 'Analects',
    sourceUrl: 'https://example.com',
    sourceDomain: 'example.com',
    surrounding: '学而时习之，不亦说乎',
    clozes: [],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
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
});

async function renderClient(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.includes(label),
  );
  if (!match) throw new Error(`Button not found: "${label}". Available: ${[...container.querySelectorAll('button')].map(b => b.textContent).join(', ')}`);
  return match;
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuoteCard cloze editor — suggest and accept', () => {
  it('renders "Suggest blanks" button', async () => {
    const quote = makeQuote();
    await renderClient(
      <QuoteCard
        quote={quote}
        words={[makeWord()]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );
    expect(container.textContent).toContain(messages.en['cloze.addBlank']);
  });

  it('shows suggestions when "Suggest blanks" is clicked', async () => {
    // Word '学而' should be found in text '学而时习之' at position 0-2
    const quote = makeQuote({ clozes: [] });
    const word = makeWord({ id: 'w-xue-er', text: '学而', normalized: '学而' });

    await renderClient(
      <QuoteCard
        quote={quote}
        words={[word]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );

    await click(button(messages.en['cloze.addBlank']));

    // The suggestion chip text '学而' should appear
    expect(container.textContent).toContain('学而');
    // Accept button should exist for the suggestion
    const acceptButtons = [...container.querySelectorAll('button')].filter(b =>
      b.textContent?.includes('Accept') || b.getAttribute('data-action') === 'accept-suggestion'
    );
    expect(acceptButtons.length).toBeGreaterThan(0);
  });

  it('accepting a suggestion calls onUpdate with new cloze including wordId', async () => {
    const onUpdate = vi.fn();
    const quote = makeQuote({ clozes: [] });
    const word = makeWord({ id: 'w-xue-er', text: '学而', normalized: '学而' });

    await renderClient(
      <QuoteCard
        quote={quote}
        words={[word]}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        locale="en"
      />,
    );

    await click(button(messages.en['cloze.addBlank']));

    // Click the accept button for the suggestion
    const acceptButton = [...container.querySelectorAll('button')].find(b =>
      b.getAttribute('data-action') === 'accept-suggestion'
    );
    expect(acceptButton).not.toBeUndefined();
    await click(acceptButton as HTMLButtonElement);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const patch = onUpdate.mock.calls[0][0];
    expect(patch).toHaveProperty('clozes');
    expect(Array.isArray(patch.clozes)).toBe(true);
    expect(patch.clozes).toHaveLength(1);
    expect(patch.clozes[0]).toMatchObject({
      start: 0,
      end: 2,
      wordId: 'w-xue-er',
    });
  });

  it('suggestions exclude spans already covered by existing clozes', async () => {
    const existingCloze: Cloze = { id: 'c1', start: 0, end: 2, hint: 'none', wordId: 'w-xue-er' };
    const quote = makeQuote({ clozes: [existingCloze] });
    const word = makeWord({ id: 'w-xue-er', text: '学而', normalized: '学而' });
    const onUpdate = vi.fn();

    await renderClient(
      <QuoteCard
        quote={quote}
        words={[word]}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        locale="en"
      />,
    );

    await click(button(messages.en['cloze.addBlank']));

    // Since the only suggestion overlaps an existing cloze, no accept buttons should appear
    const acceptButtons = [...container.querySelectorAll('[data-action="accept-suggestion"]')];
    expect(acceptButtons).toHaveLength(0);
  });
});

describe('QuoteCard cloze editor — existing cloze chips', () => {
  it('shows existing cloze chips with their text', async () => {
    const clozes: Cloze[] = [
      { id: 'c1', start: 0, end: 2, hint: 'none' },
    ];
    const quote = makeQuote({ clozes });

    await renderClient(
      <QuoteCard
        quote={quote}
        words={[]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );

    // The chip should show '学而' (quote.text.slice(0, 2))
    expect(container.textContent).toContain('学而');
  });

  it('removing a cloze chip calls onUpdate without that cloze', async () => {
    const onUpdate = vi.fn();
    const clozes: Cloze[] = [
      { id: 'c1', start: 0, end: 2, hint: 'none' },
      { id: 'c2', start: 3, end: 5, hint: 'none' },
    ];
    const quote = makeQuote({ clozes });

    await renderClient(
      <QuoteCard
        quote={quote}
        words={[]}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        locale="en"
      />,
    );

    // Find remove button for first cloze
    const removeButtons = [...container.querySelectorAll('[data-action="remove-cloze"]')];
    expect(removeButtons.length).toBeGreaterThan(0);

    await click(removeButtons[0] as HTMLButtonElement);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const patch = onUpdate.mock.calls[0][0];
    expect(patch).toHaveProperty('clozes');
    expect(patch.clozes).toHaveLength(1);
    expect(patch.clozes[0].id).toBe('c2');
  });

  it('changing a cloze hint calls onUpdate with updated hint', async () => {
    const onUpdate = vi.fn();
    const clozes: Cloze[] = [
      { id: 'c1', start: 0, end: 2, hint: 'none' },
    ];
    const quote = makeQuote({ clozes });

    await renderClient(
      <QuoteCard
        quote={quote}
        words={[]}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        locale="en"
      />,
    );

    const hintSelect = container.querySelector<HTMLSelectElement>('[data-cloze-id="c1"] select, select[data-cloze-hint="c1"]');
    expect(hintSelect).not.toBeNull();

    await act(async () => {
      hintSelect!.value = 'pinyin';
      hintSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const patch = onUpdate.mock.calls[0][0];
    expect(patch).toHaveProperty('clozes');
    expect(patch.clozes[0]).toMatchObject({ id: 'c1', hint: 'pinyin' });
  });
});

describe('QuoteCard cloze editor — overlap rejection', () => {
  it('does not call onUpdate when accepting a suggestion overlapping an existing cloze', async () => {
    // This tests normalizeClozes/clozesOverlap indirectly: if the user somehow
    // triggers an overlapping addition, it should be rejected.
    // We test by having an existing cloze and verifying a second accept is blocked.
    const onUpdate = vi.fn();
    const existingCloze: Cloze = { id: 'c1', start: 0, end: 2, hint: 'none' };
    // Use a different word that also matches at start=0
    const quote = makeQuote({
      text: '学而时习之',
      clozes: [existingCloze],
    });
    // Word '学' overlaps existing cloze '学而' (0-2)
    const word = makeWord({ id: 'w-xue', text: '学', normalized: '学' });

    await renderClient(
      <QuoteCard
        quote={quote}
        words={[word]}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        locale="en"
      />,
    );

    await click(button(messages.en['cloze.addBlank']));

    // Since suggestion overlaps existing cloze, no accept buttons
    const acceptButtons = [...container.querySelectorAll('[data-action="accept-suggestion"]')];
    expect(acceptButtons).toHaveLength(0);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
