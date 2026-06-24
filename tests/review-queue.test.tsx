// @vitest-environment happy-dom

import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  ReviewCard,
  ReviewQueue,
} from '../entrypoints/dashboard/components/ReviewQueue';
import { messages } from '../lib/i18n';
import { migrateReviewState } from '../lib/srs';
import type { QuoteEntry, WordEntry } from '../lib/types';

const NOW = new Date('2026-06-24T10:00:00').getTime();

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
    tags: [],
    note: 'a note',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    category: 'classic',
    sourceTitle: 'Analects',
    sourceUrl: 'https://example.com',
    sourceDomain: 'example.com',
    surrounding: '学而时习之，不亦说乎',
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
  vi.useRealTimers();
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
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
  });
}

describe('ReviewQueue single-card rendering', () => {
  it('renders only the first queue item and shows the remaining count', () => {
    const first = migrateReviewState(word({ id: 'w1', text: '你好' }), NOW);
    const second = migrateReviewState(
      word({ id: 'w2', text: '再见', normalized: '再见' }),
      NOW,
    );
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[
          { kind: 'word', entry: first, dueAt: NOW },
          { kind: 'word', entry: second, dueAt: NOW },
        ]}
        onAnswer={vi.fn().mockResolvedValue(undefined)}
        onPostpone={vi.fn().mockResolvedValue(undefined)}
        locale="en"
      />,
    );

    expect(html).toContain('你好');
    expect(html).not.toContain('再见');
    expect(html).toContain('2 remaining');
  });

  it('shows a word and Reveal while hiding insight and ratings', () => {
    const entry = migrateReviewState(
      word({ note: 'remember this note' }),
      NOW,
    );
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[{ kind: 'word', entry, dueAt: NOW }]}
        onAnswer={vi.fn().mockResolvedValue(undefined)}
        onPostpone={vi.fn().mockResolvedValue(undefined)}
        locale="en"
      />,
    );

    expect(html).toContain('你好');
    expect(html).toContain(messages.en['review.reveal']);
    expect(html).toContain(messages.en['review.postpone']);
    expect(html).not.toContain('remember this note');
    expect(html).not.toContain(messages.en['review.again']);
    expect(html).not.toContain(messages.en['review.good']);
  });

  it('shows revealed word insight and ratings in the large card', () => {
    const entry = migrateReviewState(word(), NOW);
    const html = renderToStaticMarkup(
      <ReviewCard
        item={{ kind: 'word', entry, dueAt: NOW }}
        remainingCount={1}
        onAnswer={vi.fn().mockResolvedValue(undefined)}
        onPostpone={vi.fn().mockResolvedValue(undefined)}
        locale="en"
        initiallyRevealed
      />,
    );

    expect(html).not.toContain(messages.en['review.reveal']);
    expect(html).toContain(messages.en['review.again']);
    expect(html).toContain(messages.en['review.hard']);
    expect(html).toContain(messages.en['review.good']);
    expect(html).toContain(messages.en['review.easy']);
  });

  it('shows quote content, note, and ratings immediately without Reveal', () => {
    const entry = migrateReviewState(quote(), NOW);
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[{ kind: 'quote', entry, dueAt: NOW }]}
        onAnswer={vi.fn().mockResolvedValue(undefined)}
        onPostpone={vi.fn().mockResolvedValue(undefined)}
        locale="en"
      />,
    );

    expect(html).toContain('学而时习之');
    expect(html).toContain('a note');
    expect(html).toContain('Analects');
    expect(html).toContain(messages.en['review.again']);
    expect(html).toContain(messages.en['review.easy']);
    expect(html).not.toContain(messages.en['review.reveal']);
    expect(html).not.toContain(messages.en['review.revealTitle']);
  });

  it('uses the larger focused review-card layout', () => {
    const entry = migrateReviewState(word(), NOW);
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[{ kind: 'word', entry, dueAt: NOW }]}
        onAnswer={vi.fn().mockResolvedValue(undefined)}
        onPostpone={vi.fn().mockResolvedValue(undefined)}
        locale="en"
      />,
    );

    expect(html).toContain('min-h-[420px]');
    expect(html).toContain('max-w-4xl');
  });
});

describe('ReviewQueue advancement', () => {
  it('disables actions during exit and advances to the next card', async () => {
    vi.useFakeTimers();
    const first = migrateReviewState(quote({ id: 'q1' }), NOW);
    const second = migrateReviewState(
      quote({
        id: 'q2',
        text: '温故而知新',
        note: '',
        category: 'classic',
      }),
      NOW,
    );

    function Harness() {
      const [items, setItems] = useState([
        { kind: 'quote' as const, entry: first, dueAt: NOW },
        { kind: 'quote' as const, entry: second, dueAt: NOW },
      ]);

      return (
        <ReviewQueue
          items={items}
          onAnswer={async () => {
            setItems((current) => current.slice(1));
          }}
          onPostpone={async () => {
            setItems((current) => current.slice(1));
          }}
          locale="en"
        />
      );
    }

    await renderClient(<Harness />);
    const again = button(messages.en['review.again']);
    await click(again);

    expect(again.disabled).toBe(true);
    expect(
      container.querySelector('[aria-busy="true"]'),
    ).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });

    expect(container.textContent).toContain('温故而知新');
    expect(container.textContent).not.toContain('学而时习之');
    expect(document.activeElement?.textContent).toContain('温故而知新');
  });

  it('resets word reveal state when the next word becomes active', async () => {
    vi.useFakeTimers();
    const first = migrateReviewState(word({ id: 'w1', text: '你好' }), NOW);
    const second = migrateReviewState(
      word({ id: 'w2', text: '再见', normalized: '再见' }),
      NOW,
    );

    function Harness() {
      const [items, setItems] = useState([
        { kind: 'word' as const, entry: first, dueAt: NOW },
        { kind: 'word' as const, entry: second, dueAt: NOW },
      ]);

      return (
        <ReviewQueue
          items={items}
          onAnswer={async () => {
            setItems((current) => current.slice(1));
          }}
          onPostpone={async () => {
            setItems((current) => current.slice(1));
          }}
          locale="en"
        />
      );
    }

    await renderClient(<Harness />);
    await click(button(messages.en['review.reveal']));
    expect(container.textContent).toContain(messages.en['review.good']);

    await click(button(messages.en['review.good']));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });

    expect(container.textContent).toContain('再见');
    expect(container.textContent).toContain(messages.en['review.reveal']);
    expect(container.textContent).not.toContain(messages.en['review.good']);
  });

  it('advances a quote without requiring Reveal', async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const entry = migrateReviewState(quote(), NOW);

    await renderClient(
      <ReviewQueue
        items={[{ kind: 'quote', entry, dueAt: NOW }]}
        onAnswer={onAnswer}
        onPostpone={vi.fn().mockResolvedValue(undefined)}
        locale="en"
      />,
    );

    expect(container.textContent).not.toContain(
      messages.en['review.reveal'],
    );
    await click(button(messages.en['review.easy']));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(onAnswer).toHaveBeenCalledWith('quote', 'q1', 'easy');
  });
});
