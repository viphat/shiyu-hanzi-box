// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuoteList } from '../entrypoints/dashboard/components/QuoteList';
import { messages } from '../lib/i18n';
import type { Cloze, QuoteEntry } from '../lib/types';

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
    sourceTitle: 'Analects',
    sourceUrl: 'https://example.com',
    sourceDomain: 'example.com',
    surrounding: '学而时习之，不亦说乎',
    ...overrides,
  };
}

function makeCloze(overrides: Partial<Cloze> = {}): Cloze {
  return { id: 'c1', start: 0, end: 2, ...overrides };
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuoteList — parked count badge', () => {
  it('shows a parked count badge when there are parked quotes', async () => {
    const quotes = [
      makeQuote({ id: 'q1' }),           // parked (no clozes)
      makeQuote({ id: 'q2', clozes: [] }), // parked (empty)
      makeQuote({ id: 'q3', clozes: [makeCloze()] }), // NOT parked
    ];

    await renderClient(
      <QuoteList
        quotes={quotes}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    // "2 parked" badge should be visible with the exact formatted string
    expect(container.textContent).toContain(
      messages.en['cloze.parkedCount'].replace('{count}', '2'),
    );
  });

  it('does not show parked badge when all quotes have clozes', async () => {
    const quotes = [
      makeQuote({ id: 'q1', clozes: [makeCloze()] }),
    ];

    await renderClient(
      <QuoteList
        quotes={quotes}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    expect(container.textContent).not.toContain('parked');
  });

  it('excludes archived quotes from parked count', async () => {
    const quotes = [
      makeQuote({ id: 'q1', status: 'archived' }), // archived → not parked
      makeQuote({ id: 'q2' }), // parked
    ];

    await renderClient(
      <QuoteList
        quotes={quotes}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    // Only 1 parked — exact formatted string
    expect(container.textContent).toContain(
      messages.en['cloze.parkedCount'].replace('{count}', '1'),
    );
  });
});

describe('QuoteList — parked filter toggle', () => {
  it('renders a filter toggle button for parked quotes', async () => {
    const quotes = [makeQuote({ id: 'q1' })];

    await renderClient(
      <QuoteList
        quotes={quotes}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    expect(queryButton(messages.en['cloze.parked'])).not.toBeNull();
  });

  it('clicking filter toggle narrows list to parked quotes only', async () => {
    const quotes = [
      makeQuote({ id: 'q1', text: '学而时习之' }),             // parked
      makeQuote({ id: 'q2', text: '温故知新', clozes: [makeCloze()] }), // NOT parked
    ];

    await renderClient(
      <QuoteList
        quotes={quotes}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    // Both quotes visible initially
    expect(container.textContent).toContain('学而时习之');
    expect(container.textContent).toContain('温故知新');

    // Click the parked filter
    const toggleBtn = queryButton(messages.en['cloze.parked']);
    expect(toggleBtn).not.toBeNull();
    await click(toggleBtn!);

    // Only parked quote visible
    expect(container.textContent).toContain('学而时习之');
    expect(container.textContent).not.toContain('温故知新');
  });

  it('clicking filter toggle again shows all quotes', async () => {
    const quotes = [
      makeQuote({ id: 'q1', text: '学而时习之' }),             // parked
      makeQuote({ id: 'q2', text: '温故知新', clozes: [makeCloze()] }), // NOT parked
    ];

    await renderClient(
      <QuoteList
        quotes={quotes}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    const toggleBtn = queryButton(messages.en['cloze.parked'])!;
    await click(toggleBtn);
    // After first click, only parked visible
    expect(container.textContent).not.toContain('温故知新');

    // Click again to deactivate
    const toggleBtnAgain = queryButton(messages.en['cloze.parked'])!;
    await click(toggleBtnAgain);
    // Both visible again
    expect(container.textContent).toContain('温故知新');
  });
});

describe('QuoteList — empty parked-filter state', () => {
  it('shows no-parked message and keeps filter toggle when filter is active but no parked quotes remain', async () => {
    // All quotes have clozes → none are parked
    const quotes = [
      makeQuote({ id: 'q1', text: '学而时习之', clozes: [makeCloze()] }),
      makeQuote({ id: 'q2', text: '温故知新', clozes: [makeCloze()] }),
    ];

    // Render with parkedCount=0 initially; we need to simulate the scenario
    // where the filter is already active. We achieve this by first rendering
    // with a parked quote, clicking the toggle, then re-rendering without parked quotes.
    const parkedQuote = makeQuote({ id: 'q0', text: '仁者爱人' }); // parked
    await renderClient(
      <QuoteList
        quotes={[parkedQuote, ...quotes]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    // Activate the filter
    const toggleBtn = queryButton(messages.en['cloze.parked'])!;
    expect(toggleBtn).not.toBeNull();
    await click(toggleBtn);

    // Now re-render with no parked quotes (simulating the last parked quote being resolved)
    await renderClient(
      <QuoteList
        quotes={quotes}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    // The "no parked quotes" message should be visible
    expect(container.textContent).toContain(messages.en['cloze.noParked']);
    // The filter toggle should still be rendered so the user can turn it off
    expect(queryButton(messages.en['cloze.parked'])).not.toBeNull();
    // Non-parked quotes should NOT be visible while filter is active
    expect(container.textContent).not.toContain('学而时习之');
    expect(container.textContent).not.toContain('温故知新');
  });

  it('toggling the filter off after empty-state reveals all quotes', async () => {
    const quotes = [
      makeQuote({ id: 'q1', text: '学而时习之', clozes: [makeCloze()] }),
    ];

    const parkedQuote = makeQuote({ id: 'q0', text: '仁者爱人' });
    await renderClient(
      <QuoteList
        quotes={[parkedQuote, ...quotes]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    // Turn the filter on
    await click(queryButton(messages.en['cloze.parked'])!);

    // Re-render with no parked quotes
    await renderClient(
      <QuoteList
        quotes={quotes}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    // Confirm empty state
    expect(container.textContent).toContain(messages.en['cloze.noParked']);

    // Turn the filter off
    await click(queryButton(messages.en['cloze.parked'])!);

    // All quotes now visible
    expect(container.textContent).toContain('学而时习之');
    expect(container.textContent).not.toContain(messages.en['cloze.noParked']);
  });
});

describe('QuoteCard — parked visual marker', () => {
  it('shows parked chip on a quote with no clozes', async () => {
    const quotes = [makeQuote({ id: 'q1' })]; // no clozes → parked

    await renderClient(
      <QuoteList
        quotes={quotes}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    expect(container.textContent).toContain(messages.en['cloze.parked']);
  });

  it('does not show parked chip on a quote with clozes', async () => {
    const quotes = [makeQuote({ id: 'q1', clozes: [makeCloze()] })];

    await renderClient(
      <QuoteList
        quotes={quotes}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onSetTags={vi.fn()}
        locale="en"
      />,
    );

    // The parked chip should not appear (the ClozeEditor label might not have it)
    // We check that it's not in the card area (outside the QuoteList filter badge)
    // We check there's no standalone "Parked — no blank" chip
    const parkedLabel = messages.en['cloze.parked'];
    // Count occurrences - should be 0 (no badge since 0 parked, no chip on card)
    const occurrences = (container.textContent ?? '').split(parkedLabel).length - 1;
    expect(occurrences).toBe(0);
  });
});
