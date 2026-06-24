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

describe('ReviewQueue reveal-then-rate flow', () => {
  it('has Again/Hard/Good/Easy and Reveal/Postpone labels in i18n', () => {
    expect(messages.en).toHaveProperty('review.reveal');
    expect(messages.en).toHaveProperty('review.again');
    expect(messages.en).toHaveProperty('review.hard');
    expect(messages.en).toHaveProperty('review.good');
    expect(messages.en).toHaveProperty('review.easy');
    expect(messages.en).toHaveProperty('review.postpone');
    expect(messages['zh-CN']).toHaveProperty('review.reveal');
    expect(messages['zh-CN']).toHaveProperty('review.again');
  });

  it('shows the word prompt and a Reveal button before answer details', () => {
    const entry = migrateReviewState(word(), NOW);
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[{ kind: 'word', entry, dueAt: NOW }]}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );
    expect(html).toContain('你好');
    expect(html).toContain(messages.en['review.reveal']);
  });

  it('hides the quote text until reveal (shows category/source first)', () => {
    const entry = migrateReviewState(quote(), NOW);
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[{ kind: 'quote', entry, dueAt: NOW }]}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );
    expect(html).toContain('classic');
    expect(html).toContain(messages.en['review.reveal']);
    expect(html).not.toContain('学而时习之');
  });

  it('shows quote answer details and rating controls after reveal', () => {
    const entry = migrateReviewState(quote(), NOW);
    const html = renderToStaticMarkup(
      <ReviewCard
        item={{ kind: 'quote', entry, dueAt: NOW }}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
        initiallyRevealed
      />,
    );
    expect(html).toContain('学而时习之');
    expect(html).toContain('a note');
    expect(html).toContain(messages.en['review.again']);
    expect(html).toContain(messages.en['review.easy']);
  });

  it('opens the existing word insight reveal with the main answer reveal', () => {
    const entry = migrateReviewState(word(), NOW);
    const html = renderToStaticMarkup(
      <ReviewCard
        item={{ kind: 'word', entry, dueAt: NOW }}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
        initiallyRevealed
      />,
    );
    expect(html).not.toContain(messages.en['review.showDefinitions']);
    expect(html).toContain(messages.en['review.good']);
  });
});
