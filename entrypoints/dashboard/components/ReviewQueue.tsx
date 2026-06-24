import {
  Eye,
  MessageSquareQuote,
  RotateCw,
  WholeWord,
} from 'lucide-react';
import { useState } from 'react';
import { t } from '@/lib/i18n';
import type { SrsQueueItem } from '@/lib/srs';
import type { Entry, ReviewRating, UiLocale } from '@/lib/types';
import { ReviewInsightReveal } from './ReviewInsightReveal';

const RATINGS: Array<{
  rating: ReviewRating;
  labelKey:
    | 'review.again'
    | 'review.hard'
    | 'review.good'
    | 'review.easy';
  titleKey:
    | 'review.againTitle'
    | 'review.hardTitle'
    | 'review.goodTitle'
    | 'review.easyTitle';
  tone: 'muted' | 'cinnabar' | 'good' | 'easy';
}> = [
  {
    rating: 'again',
    labelKey: 'review.again',
    titleKey: 'review.againTitle',
    tone: 'muted',
  },
  {
    rating: 'hard',
    labelKey: 'review.hard',
    titleKey: 'review.hardTitle',
    tone: 'cinnabar',
  },
  {
    rating: 'good',
    labelKey: 'review.good',
    titleKey: 'review.goodTitle',
    tone: 'good',
  },
  {
    rating: 'easy',
    labelKey: 'review.easy',
    titleKey: 'review.easyTitle',
    tone: 'easy',
  },
];

export function ReviewQueue({
  items,
  onAnswer,
  onPostpone,
  locale,
}: {
  items: SrsQueueItem[];
  onAnswer: (
    kind: Entry['kind'],
    id: string,
    rating: ReviewRating,
  ) => void;
  onPostpone: (kind: Entry['kind'], id: string) => void;
  locale: UiLocale;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-border bg-paper-light py-12 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center text-[56px] leading-none text-ink/12">
          习
        </div>
        <p className="text-base font-medium text-ink-secondary tracking-[3px]">
          {t(locale, 'review.emptyTitle')}
        </p>
        <p className="mt-1 text-xs text-muted">
          {t(locale, 'review.emptyBody')}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <ReviewCard
          key={`${item.kind}:${item.entry.id}`}
          item={item}
          onAnswer={(rating) =>
            onAnswer(item.kind, item.entry.id, rating)
          }
          onPostpone={() => onPostpone(item.kind, item.entry.id)}
          locale={locale}
        />
      ))}
    </div>
  );
}

export function ReviewCard({
  item,
  onAnswer,
  onPostpone,
  locale,
  initiallyRevealed = false,
}: {
  item: SrsQueueItem;
  onAnswer: (rating: ReviewRating) => void;
  onPostpone: () => void;
  locale: UiLocale;
  initiallyRevealed?: boolean;
}) {
  const { entry } = item;
  const [revealed, setRevealed] = useState(initiallyRevealed);
  const source = getSourceLabel(entry);

  return (
    <article className="rounded-sm border border-border bg-paper-light p-4 shadow-sm transition hover:border-border-hover hover:shadow-md">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1 rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1 font-medium text-cinnabar tracking-[1px]">
          {entry.kind === 'word' ? (
            <WholeWord className="h-3.5 w-3.5" />
          ) : (
            <MessageSquareQuote className="h-3.5 w-3.5" />
          )}
          {entry.kind === 'word'
            ? t(locale, 'review.kindWord')
            : t(locale, 'review.kindQuote')}
        </span>
        <span className="rounded-sm border border-border bg-paper-input px-2 py-1">
          {entry.status === 'inbox'
            ? t(locale, 'app.inbox')
            : t(locale, 'app.reviewed')}
        </span>
        {entry.kind === 'quote' && (
          <span className="rounded-sm border border-border bg-paper-input px-2 py-1">
            {entry.category}
          </span>
        )}
        {source && (
          <span className="truncate rounded-sm border border-border bg-paper-input px-2 py-1">
            {source}
          </span>
        )}
      </div>

      {entry.kind === 'word' ? (
        <h2 className="mt-3 text-[32px] font-bold leading-none text-ink tracking-[4px]">
          {entry.text}
        </h2>
      ) : (
        <p className="mt-3 text-sm text-muted tracking-[1px]">
          {revealed ? null : t(locale, 'review.revealTitle')}
        </p>
      )}

      {revealed && entry.kind === 'quote' && (
        <blockquote className="relative mt-3 border-l-[3px] border-cinnabar-fade py-1 pl-5 pr-4 text-base leading-8 text-ink tracking-[1px]">
          <span
            aria-hidden="true"
            className="absolute left-2 top-0 text-xl text-cinnabar/40"
          >
            「
          </span>
          <span>{entry.text}</span>
          <span
            aria-hidden="true"
            className="absolute bottom-0 right-1 text-xl text-cinnabar/40"
          >
            」
          </span>
        </blockquote>
      )}

      {revealed && entry.kind === 'quote' && entry.note && (
        <p className="mt-3 rounded-sm border border-border bg-paper-input px-3 py-2 text-sm leading-6 text-ink-secondary">
          {entry.note}
        </p>
      )}

      {revealed && entry.kind === 'word' && (
        <ReviewInsightReveal
          word={entry}
          locale={locale}
          initiallyRevealed
        />
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            title={t(locale, 'review.revealTitle')}
            className="inline-flex items-center gap-1 rounded-sm bg-cinnabar px-3 py-2 text-sm font-medium text-white shadow-sm tracking-[2px] transition hover:brightness-95"
          >
            <Eye className="h-4 w-4" /> {t(locale, 'review.reveal')}
          </button>
        ) : (
          <>
            {RATINGS.map(({ rating, labelKey, titleKey, tone }) => (
              <button
                key={rating}
                onClick={() => onAnswer(rating)}
                title={t(locale, titleKey)}
                className={`inline-flex items-center gap-1 rounded-sm px-3 py-2 text-sm font-medium tracking-[2px] transition ${toneClasses(tone)}`}
              >
                {t(locale, labelKey)}
              </button>
            ))}
            <button
              onClick={onPostpone}
              title={t(locale, 'review.postponeTitle')}
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-3 py-2 text-sm font-medium text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input"
            >
              <RotateCw className="h-4 w-4" />{' '}
              {t(locale, 'review.postpone')}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function toneClasses(
  tone: 'muted' | 'cinnabar' | 'good' | 'easy',
): string {
  switch (tone) {
    case 'muted':
      return 'border border-border bg-transparent text-ink-secondary hover:border-border-hover hover:bg-paper-input';
    case 'cinnabar':
      return 'border border-cinnabar-border bg-cinnabar-light text-cinnabar hover:bg-cinnabar hover:text-white';
    case 'good':
      return 'bg-cinnabar text-white shadow-sm hover:brightness-95';
    case 'easy':
      return 'border border-border bg-paper-input text-ink hover:border-cinnabar-fade';
  }
}

function getSourceLabel(entry: Entry): string {
  if (entry.kind === 'quote') {
    return entry.sourceTitle || entry.sourceDomain;
  }
  const latest = entry.occurrences[entry.occurrences.length - 1];
  return latest?.sourceTitle || latest?.sourceDomain || '';
}
