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
import type { Cloze, QuoteEntry, WordEntry } from '../lib/types';

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

// ---------------------------------------------------------------------------
// Cloze review tests
// ---------------------------------------------------------------------------

function makeCloze(overrides: Partial<Cloze> = {}): Cloze {
  return {
    id: 'c1',
    start: 0,
    end: 2,
    hint: 'none',
    ...overrides,
  };
}

function quoteWithClozes(
  text: string,
  clozes: Cloze[],
  noteOverride = 'a note',
): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text,
    tags: [],
    note: noteOverride,
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    sourceTitle: 'Analects',
    sourceUrl: 'https://example.com',
    sourceDomain: 'example.com',
    surrounding: text,
    clozes,
  };
}

describe('Cloze review card', () => {
  it('blanks only the active span; other cloze text remains visible', () => {
    // text: 学而时习之 (5 chars)
    // cloze1: 学而 (0-2), cloze2: 时习 (2-4)
    const cloze1 = makeCloze({ id: 'c1', start: 0, end: 2, hint: 'none' });
    const cloze2 = makeCloze({ id: 'c2', start: 2, end: 4, hint: 'none' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze1, cloze2]),
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

    // Active span (学而) should be hidden as blank
    expect(html).not.toContain('学而');
    // Non-active span (时习) and trailing char (之) should still appear
    expect(html).toContain('时习');
    expect(html).toContain('之');
    // Blank placeholder should be present
    expect(html).toContain('____');
  });

  it('hint:none renders fixed ____ blank', () => {
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2, hint: 'none' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze]),
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
  });

  it('hint:length renders one box per hidden character', () => {
    // answer span is 3 chars: 时习之 (start=2, end=5)
    const cloze = makeCloze({ id: 'c1', start: 2, end: 5, hint: 'length' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze]),
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
    // Should render 3 boxes (one per char)
    const matches = html.match(/data-cloze-box/g);
    expect(matches?.length).toBe(3);
  });

  it('hint:pinyin shows pinyin above the blank', () => {
    // answer: 学 (start=0, end=1)
    const cloze = makeCloze({ id: 'c1', start: 0, end: 1, hint: 'pinyin' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze]),
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
    // 学 has pinyin "xué" or "xue2" — check for "xue" as a substring
    expect(html.toLowerCase()).toMatch(/xu[eé]/);
  });

  it('ratings are hidden before Reveal on a cloze card', () => {
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2, hint: 'none' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze]),
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
    expect(html).toContain(messages.en['review.reveal']);
    expect(html).not.toContain(messages.en['review.again']);
    expect(html).not.toContain(messages.en['review.good']);
  });

  it('reveal shows the answer highlighted and the note, then rating buttons', async () => {
    // Use a note that contains the answer '学而' — it must be hidden before reveal (spoiler)
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2, hint: 'none' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze], '学而 spoiler note'),
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

    // Before reveal: answer absent, spoiler note absent, no ratings
    expect(container.textContent).not.toContain('学而');
    expect(container.textContent).not.toContain('学而 spoiler note');
    expect(container.textContent).not.toContain(messages.en['review.again']);

    await click(button(messages.en['review.reveal']));

    // After reveal: answer highlighted (full text present), note present, ratings visible
    expect(container.textContent).toContain('学而时习之');
    expect(container.textContent).toContain('学而 spoiler note');
    expect(container.textContent).toContain(messages.en['review.again']);
    expect(container.textContent).toContain(messages.en['review.good']);
  });

  it('hides the note on the front when the note contains the answer substring', () => {
    // note contains the answer "学而"
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2, hint: 'none' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze], '学而 is learning'),
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
    // Note should be hidden when it contains the answer
    expect(html).not.toContain('学而 is learning');
  });

  it('shows the note on the front when the note does NOT contain the answer substring', () => {
    // note = 'a helpful mnemonic' — does not contain the answer '学而'
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2, hint: 'none' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze], 'a helpful mnemonic'),
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
    // Non-spoiler note must be visible on the front (before reveal)
    expect(html).toContain('a helpful mnemonic');
  });

  it('shows the note after reveal even when it contains the answer', async () => {
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2, hint: 'none' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze], '学而 is learning'),
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

    await click(button(messages.en['review.reveal']));
    expect(container.textContent).toContain('学而 is learning');
  });

  it('shows answer pinyin label and pinyin text after reveal on a cloze card', async () => {
    // answer: 学而 (start=0, end=2) — pinyin should contain "xue" or similar
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2, hint: 'none' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze]),
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

    // Before reveal: answer label should not be visible
    expect(container.textContent).not.toContain(messages.en['review.answer']);

    await click(button(messages.en['review.reveal']));

    // After reveal: "Answer:" label and pinyin of 学而 must be present
    expect(container.textContent).toContain(messages.en['review.answer']);
    // 学 pinyin contains "xué" (toned) or "xue", 而 pinyin contains "ér" or "er"
    expect(container.textContent).toMatch(/xu[eé]/i);
    expect(container.textContent).toMatch(/[eé]r/i);
  });

  it('does not render a Traditional (繁) toggle on the cloze review card', () => {
    // Regression guard: cloze offsets index Simplified text. A Traditional
    // conversion can change string length, so the offsets would not map onto
    // traditionalText — a misaligned blank is worse than no toggle. The 繁
    // button must NEVER appear on a cloze quote review card (no offset remapping
    // in v1 per spec §8).
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2, hint: 'none' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze]),
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
    // TraditionalButton renders the character 繁 as its label text
    expect(html).not.toContain('繁');
  });

  it('rating call passes the clozeId to onAnswer', async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const cloze = makeCloze({ id: 'c1', start: 0, end: 2, hint: 'none' });
    const entry = migrateReviewState(
      quoteWithClozes('学而时习之', [cloze]),
      NOW,
    );

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
    // Reveal first
    await click(button(messages.en['review.reveal']));
    // Then rate
    await click(button(messages.en['review.good']));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });

    expect(onAnswer).toHaveBeenCalledWith('quote', 'q1', 'good', 'c1');
  });
});
