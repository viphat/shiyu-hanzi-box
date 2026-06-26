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
    expect(onAnswer).toHaveBeenCalledWith('quote', 'q1', 'easy', undefined);
  });
});

// ---------------------------------------------------------------------------
// Task 8: cloze front / blank / reveal tests
// ---------------------------------------------------------------------------

describe('Cloze quote review card', () => {
  // Helper: a quote with two clozes
  // text: '学而时习之' (5 chars)
  // cloze1: chars 0-2 = '学而' (start=0, end=2)
  // cloze2: chars 3-5 = '习之' (start=3, end=5)
  function clozedQuote() {
    return migrateReviewState(
      quote({
        text: '学而时习之',
        note: '孔子语录',
        clozes: [
          { id: 'c1', start: 0, end: 2, hint: 'none' },
          { id: 'c2', start: 3, end: 5, hint: 'none' },
        ],
      }),
      NOW,
    );
  }

  it('blanks only the active span — front shows second span text but not first', () => {
    const entry = clozedQuote();
    const html = renderToStaticMarkup(
      <ReviewCard
        item={{ kind: 'quote', entry, dueAt: NOW, clozeId: 'c1' }}
        remainingCount={1}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );
    // The active cloze text (学而) should NOT appear literally
    expect(html).not.toContain('学而');
    // The non-active cloze text (习之) and the middle char (时) should be visible
    expect(html).toContain('习之');
    expect(html).toContain('时');
    // blank token (____) for hint: 'none'
    expect(html).toContain('____');
  });

  it('hint none renders fixed ____', () => {
    const entry = migrateReviewState(
      quote({
        clozes: [{ id: 'c1', start: 0, end: 2, hint: 'none' }],
      }),
      NOW,
    );
    const html = renderToStaticMarkup(
      <ReviewCard
        item={{ kind: 'quote', entry, dueAt: NOW, clozeId: 'c1' }}
        remainingCount={1}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );
    expect(html).toContain('____');
    // answer text (学而) should be hidden
    expect(html).not.toContain('学而');
  });

  it('hint length renders one box per hidden character', () => {
    // cloze covers '学而时' (3 chars, start=0, end=3)
    const entry = migrateReviewState(
      quote({
        clozes: [{ id: 'c1', start: 0, end: 3, hint: 'length' }],
      }),
      NOW,
    );
    const html = renderToStaticMarkup(
      <ReviewCard
        item={{ kind: 'quote', entry, dueAt: NOW, clozeId: 'c1' }}
        remainingCount={1}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );
    // Should have 3 boxes (□ or similar indicator; look for data-cloze-box or multiple box spans)
    // We test by counting how many box elements appear
    const dom = new DOMParser().parseFromString(html, 'text/html');
    const boxes = dom.querySelectorAll('[data-cloze-box]');
    expect(boxes.length).toBe(3);
  });

  it('hint pinyin shows pinyin above the blank', () => {
    const entry = migrateReviewState(
      quote({
        clozes: [{ id: 'c1', start: 0, end: 2, hint: 'pinyin' }],
      }),
      NOW,
    );
    const html = renderToStaticMarkup(
      <ReviewCard
        item={{ kind: 'quote', entry, dueAt: NOW, clozeId: 'c1' }}
        remainingCount={1}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );
    // pinyin for '学而' should appear
    expect(html).toContain('data-cloze-pinyin');
    // the answer text itself should not appear literally
    expect(html).not.toContain('学而');
  });

  it('reveal shows full text with answer highlighted and note', async () => {
    const entry = clozedQuote();
    await renderClient(
      <ReviewCard
        item={{ kind: 'quote', entry, dueAt: NOW, clozeId: 'c1' }}
        remainingCount={1}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );
    // Before reveal: ratings are not shown
    expect(container.textContent).not.toContain(messages.en['review.again']);
    expect(container.textContent).not.toContain(messages.en['review.good']);
    // Reveal button is present
    expect(container.textContent).toContain(messages.en['review.reveal']);

    await click(button(messages.en['review.reveal']));

    // After reveal: full answer text appears highlighted
    expect(container.innerHTML).toContain('学而');
    // Note is shown after reveal
    expect(container.textContent).toContain('孔子语录');
    // Ratings appear
    expect(container.textContent).toContain(messages.en['review.again']);
    expect(container.textContent).toContain(messages.en['review.good']);
  });

  it('hides note on front when note contains the answer, shows it on reveal', async () => {
    // note contains the answer substring
    const entry = migrateReviewState(
      quote({
        text: '学而时习之',
        note: '学而 is a phrase',
        clozes: [{ id: 'c1', start: 0, end: 2, hint: 'none' }],
      }),
      NOW,
    );
    await renderClient(
      <ReviewCard
        item={{ kind: 'quote', entry, dueAt: NOW, clozeId: 'c1' }}
        remainingCount={1}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );
    // Note contains answer — hide on front
    expect(container.textContent).not.toContain('学而 is a phrase');

    await click(button(messages.en['review.reveal']));

    // After reveal — note is shown
    expect(container.textContent).toContain('学而 is a phrase');
  });

  it('cloze quote shows Reveal button on front (not ratings)', () => {
    const entry = clozedQuote();
    const html = renderToStaticMarkup(
      <ReviewCard
        item={{ kind: 'quote', entry, dueAt: NOW, clozeId: 'c1' }}
        remainingCount={1}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );
    expect(html).toContain(messages.en['review.reveal']);
    expect(html).not.toContain(messages.en['review.again']);
    expect(html).not.toContain(messages.en['review.good']);
  });

  it('onAnswer receives clozeId when rating a cloze quote', async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const entry = clozedQuote();

    function Harness() {
      const [items, setItems] = useState([
        { kind: 'quote' as const, entry, dueAt: NOW, clozeId: 'c1' },
      ]);
      return (
        <ReviewQueue
          items={items}
          onAnswer={async (kind, id, rating, clozeId) => {
            onAnswer(kind, id, rating, clozeId);
            setItems([]);
          }}
          onPostpone={vi.fn().mockResolvedValue(undefined)}
          locale="en"
        />
      );
    }

    await renderClient(<Harness />);
    await click(button(messages.en['review.reveal']));
    await click(button(messages.en['review.good']));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(onAnswer).toHaveBeenCalledWith('quote', 'q1', 'good', 'c1');
  });
});
