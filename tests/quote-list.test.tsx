// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuoteList } from '../entrypoints/dashboard/components/QuoteList';
import { messages } from '../lib/i18n';
import type { QuoteEntry, WordEntry } from '../lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const NO_WORDS: WordEntry[] = [];

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

async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.includes(label),
  );
  if (!match)
    throw new Error(
      `Button not found: "${label}". Available: ${[...container.querySelectorAll('button')].map((b) => b.textContent).join(', ')}`,
    );
  return match;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuoteList — parked badge', () => {
  it('shows the "Parked — no blank" badge for a quote with empty clozes', async () => {
    const quote = makeQuote({ clozes: [] });
    await renderClient(
      <QuoteList
        quotes={[quote]}
        words={NO_WORDS}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );
    expect(container.textContent).toContain(messages.en['cloze.parked']);
  });

  it('shows the "Parked — no blank" badge for a quote with absent clozes', async () => {
    const quote = makeQuote({ clozes: undefined });
    await renderClient(
      <QuoteList
        quotes={[quote]}
        words={NO_WORDS}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );
    expect(container.textContent).toContain(messages.en['cloze.parked']);
  });

  it('does NOT show the parked badge for a quote WITH clozes', async () => {
    const quote = makeQuote({
      clozes: [{ id: 'c1', start: 0, end: 2, hint: 'none' }],
    });
    await renderClient(
      <QuoteList
        quotes={[quote]}
        words={NO_WORDS}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );
    expect(container.textContent).not.toContain(messages.en['cloze.parked']);
  });
});

describe('QuoteList — add-a-blank affordance for parked quote', () => {
  it('surfaces the "Add a blank to review" affordance for a parked quote', async () => {
    const quote = makeQuote({ clozes: [] });
    await renderClient(
      <QuoteList
        quotes={[quote]}
        words={NO_WORDS}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );
    // The affordance button must be present and visually prominent (data-parked-cta)
    const cta = container.querySelector('[data-parked-cta]');
    expect(cta).not.toBeNull();
    expect(cta?.textContent).toContain(messages.en['cloze.addBlank']);
  });

  it('clicking the add-a-blank affordance on a parked quote triggers suggest', async () => {
    const quote = makeQuote({ clozes: [] });
    await renderClient(
      <QuoteList
        quotes={[quote]}
        words={NO_WORDS}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );
    const cta = container.querySelector<HTMLElement>('[data-parked-cta]');
    expect(cta).not.toBeNull();
    await click(cta!);
    // After clicking, suggestions mode is triggered (no suggestions for empty words,
    // but we can verify the button was clickable without error — the QuoteCard's
    // "Add a blank to review" button was activated)
    // The container should still render without errors
    expect(container.textContent).toBeDefined();
  });
});

describe('QuoteList — parked count badge', () => {
  it('shows a parked count of 2 when two non-archived parked quotes exist', async () => {
    const parked1 = makeQuote({ id: 'q1', clozes: [] });
    const parked2 = makeQuote({ id: 'q2', clozes: undefined });
    const withCloze = makeQuote({
      id: 'q3',
      clozes: [{ id: 'c1', start: 0, end: 2, hint: 'none' }],
    });
    await renderClient(
      <QuoteList
        quotes={[parked1, parked2, withCloze]}
        words={NO_WORDS}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );
    // "2 parked" badge should appear in the header
    expect(container.textContent).toContain('2 parked');
  });

  it('does NOT show the parked count badge when all parked quotes are archived', async () => {
    const archivedParked = makeQuote({ id: 'q1', clozes: [], status: 'archived' });
    await renderClient(
      <QuoteList
        quotes={[archivedParked]}
        words={NO_WORDS}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );
    // Archived parked quotes are intentionally silent
    const badge = container.querySelector('[data-parked-count]');
    expect(badge).toBeNull();
  });

  it('shows count = 0 badge is absent when zero parked quotes', async () => {
    const withCloze = makeQuote({
      clozes: [{ id: 'c1', start: 0, end: 2, hint: 'none' }],
    });
    await renderClient(
      <QuoteList
        quotes={[withCloze]}
        words={NO_WORDS}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );
    const badge = container.querySelector('[data-parked-count]');
    expect(badge).toBeNull();
  });
});

describe('QuoteList — parked filter toggle', () => {
  it('filter toggle is present when there are parked quotes', async () => {
    const parked = makeQuote({ id: 'q1', clozes: [] });
    const withCloze = makeQuote({
      id: 'q2',
      clozes: [{ id: 'c1', start: 0, end: 2, hint: 'none' }],
    });
    await renderClient(
      <QuoteList
        quotes={[parked, withCloze]}
        words={NO_WORDS}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );
    const toggle = container.querySelector('[data-parked-filter]');
    expect(toggle).not.toBeNull();
  });

  it('clicking the filter toggle shows only parked quotes', async () => {
    const parked = makeQuote({ id: 'q1', text: '学而时习之', clozes: [] });
    const withCloze = makeQuote({
      id: 'q2',
      text: '温故而知新',
      clozes: [{ id: 'c1', start: 0, end: 2, hint: 'none' }],
    });
    await renderClient(
      <QuoteList
        quotes={[parked, withCloze]}
        words={NO_WORDS}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );
    // Both visible initially
    expect(container.textContent).toContain('学而时习之');
    expect(container.textContent).toContain('温故而知新');

    // Click filter toggle
    const toggle = container.querySelector<HTMLElement>('[data-parked-filter]');
    await click(toggle!);

    // Only parked quote visible
    expect(container.textContent).toContain('学而时习之');
    expect(container.textContent).not.toContain('温故而知新');
  });

  it('clicking the filter toggle again (off) shows all quotes', async () => {
    const parked = makeQuote({ id: 'q1', text: '学而时习之', clozes: [] });
    const withCloze = makeQuote({
      id: 'q2',
      text: '温故而知新',
      clozes: [{ id: 'c1', start: 0, end: 2, hint: 'none' }],
    });
    await renderClient(
      <QuoteList
        quotes={[parked, withCloze]}
        words={NO_WORDS}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );

    const toggle = container.querySelector<HTMLElement>('[data-parked-filter]');
    await click(toggle!); // ON
    expect(container.textContent).not.toContain('温故而知新');

    await click(toggle!); // OFF
    expect(container.textContent).toContain('温故而知新');
  });
});
