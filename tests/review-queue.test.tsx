import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
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
