import {
  Eye,
  MessageSquareQuote,
  RotateCw,
  WholeWord,
} from 'lucide-react';
import { useState } from 'react';
import { formatMessage, t } from '@/lib/i18n';
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

type AnswerHandler = (
  kind: Entry['kind'],
  id: string,
  rating: ReviewRating,
) => void | Promise<void>;

type PostponeHandler = (
  kind: Entry['kind'],
  id: string,
) => void | Promise<void>;

export function ReviewQueue({
  items,
  onAnswer,
  onPostpone,
  locale,
}: {
  items: SrsQueueItem[];
  onAnswer: AnswerHandler;
  onPostpone: PostponeHandler;
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
    <ActiveReviewCard
      items={items}
      onAnswer={onAnswer}
      onPostpone={onPostpone}
      locale={locale}
    />
  );
}

function ActiveReviewCard({
  items,
  onAnswer,
  onPostpone,
  locale,
}: {
  items: SrsQueueItem[];
  onAnswer: AnswerHandler;
  onPostpone: PostponeHandler;
  locale: UiLocale;
}) {
  const activeItem = items[0];
  const activeKey = `${activeItem.kind}:${activeItem.entry.id}`;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <ReviewCard
        key={activeKey}
        item={activeItem}
        remainingCount={items.length}
        onAnswer={(rating) =>
          onAnswer(activeItem.kind, activeItem.entry.id, rating)
        }
        onPostpone={() =>
          onPostpone(activeItem.kind, activeItem.entry.id)
        }
        locale={locale}
      />
    </div>
  );
}

export function ReviewCard({
  item,
  remainingCount,
  onAnswer,
  onPostpone,
  locale,
  initiallyRevealed = false,
  busy = false,
  transitionClassName = 'review-card-enter',
}: {
  item: SrsQueueItem;
  remainingCount: number;
  onAnswer: (rating: ReviewRating) => void | Promise<void>;
  onPostpone: () => void | Promise<void>;
  locale: UiLocale;
  initiallyRevealed?: boolean;
  busy?: boolean;
  transitionClassName?: string;
}) {
  const { entry } = item;
  const [revealed, setRevealed] = useState(
    entry.kind === 'quote' || initiallyRevealed,
  );
  const answerVisible = entry.kind === 'quote' || revealed;
  const source = getSourceLabel(entry);

  return (
    <article
      aria-busy={busy}
      className={`flex min-h-[420px] flex-col rounded-sm border border-border bg-paper-light p-6 shadow-md sm:p-8 ${transitionClassName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
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
            <span className="max-w-64 truncate rounded-sm border border-border bg-paper-input px-2 py-1">
              {source}
            </span>
          )}
        </div>
        <span className="shrink-0 rounded-sm border border-border bg-paper-input px-3 py-1.5 text-xs text-muted">
          {formatMessage(locale, 'review.remaining', {
            count: remainingCount,
          })}
        </span>
      </div>

      {entry.kind === 'word' && (
        <div className="flex min-h-[220px] flex-1 items-center justify-center py-8 text-center">
          <h2
            tabIndex={-1}
            className="text-5xl font-bold leading-tight text-ink tracking-[8px] sm:text-6xl"
          >
            {entry.text}
          </h2>
        </div>
      )}

      {entry.kind === 'quote' && (
        <div className="flex flex-1 flex-col justify-center py-8">
          <blockquote
            tabIndex={-1}
            className="relative border-l-[3px] border-cinnabar-fade py-3 pl-7 pr-5 text-2xl leading-[2] text-ink tracking-[2px] sm:text-3xl"
          >
            <span
              aria-hidden="true"
              className="absolute left-2 top-1 text-2xl text-cinnabar/40"
            >
              「
            </span>
            <span>{entry.text}</span>
            <span
              aria-hidden="true"
              className="absolute bottom-0 right-1 text-2xl text-cinnabar/40"
            >
              」
            </span>
          </blockquote>
          {entry.note && (
            <p className="mt-5 rounded-sm border border-border bg-paper-input px-4 py-3 text-sm leading-7 text-ink-secondary">
              {entry.note}
            </p>
          )}
        </div>
      )}

      {answerVisible && entry.kind === 'word' && (
        <div className="mb-6 border-t border-border pt-4">
          <ReviewInsightReveal
            word={entry}
            locale={locale}
            initiallyRevealed
          />
        </div>
      )}

      <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-5">
        {entry.kind === 'word' && !revealed ? (
          <>
            <button
              type="button"
              onClick={() => setRevealed(true)}
              disabled={busy}
              title={t(locale, 'review.revealTitle')}
              className="inline-flex items-center gap-1 rounded-sm bg-cinnabar px-4 py-2.5 text-sm font-medium text-white shadow-sm tracking-[2px] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Eye className="h-4 w-4" />
              {t(locale, 'review.reveal')}
            </button>
            <PostponeButton
              busy={busy}
              onPostpone={onPostpone}
              locale={locale}
            />
          </>
        ) : (
          <>
            {RATINGS.map(({ rating, labelKey, titleKey, tone }) => (
              <button
                type="button"
                key={rating}
                onClick={() => onAnswer(rating)}
                disabled={busy}
                title={t(locale, titleKey)}
                className={`inline-flex items-center gap-1 rounded-sm px-4 py-2.5 text-sm font-medium tracking-[2px] transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses(tone)}`}
              >
                {t(locale, labelKey)}
              </button>
            ))}
            <PostponeButton
              busy={busy}
              onPostpone={onPostpone}
              locale={locale}
            />
          </>
        )}
      </div>
    </article>
  );
}

function PostponeButton({
  busy,
  onPostpone,
  locale,
}: {
  busy: boolean;
  onPostpone: () => void | Promise<void>;
  locale: UiLocale;
}) {
  return (
    <button
      type="button"
      onClick={onPostpone}
      disabled={busy}
      title={t(locale, 'review.postponeTitle')}
      className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RotateCw className="h-4 w-4" />
      {t(locale, 'review.postpone')}
    </button>
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
