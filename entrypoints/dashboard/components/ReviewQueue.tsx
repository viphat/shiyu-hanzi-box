import {
  Eye,
  MessageSquareQuote,
  RotateCw,
  WholeWord,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatMessage, t } from '@/lib/i18n';
import { toPinyin } from '@/lib/pinyin';
import type { SrsQueueItem } from '@/lib/srs';
import type { Cloze, Entry, QuoteEntry, ReviewRating, UiLocale } from '@/lib/types';
import { ReviewInsightReveal } from './ReviewInsightReveal';
import { SpeakButton } from './SpeakButton';

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
  tone: 'muted' | 'accent' | 'good' | 'easy';
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
    tone: 'accent',
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
  clozeId?: string,
) => void | Promise<void>;

type PostponeHandler = (
  kind: Entry['kind'],
  id: string,
  clozeId?: string,
) => void | Promise<void>;

const REVIEW_TRANSITION_MS = 160;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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
  const [busy, setBusy] = useState(false);
  const [exiting, setExiting] = useState(false);
  const previousActiveKey = useRef<string | null>(null);
  const activeItem = items[0];
  // Include clozeId in the key so switching between two clozes of the same quote remounts
  const activeKey = `${activeItem.kind}:${activeItem.entry.id}:${activeItem.clozeId ?? ''}`;
  const focusOnMount =
    previousActiveKey.current !== null &&
    previousActiveKey.current !== activeKey;

  useEffect(() => {
    previousActiveKey.current = activeKey;
  }, [activeKey]);

  async function runAction(action: () => void | Promise<void>) {
    if (busy) return;
    setBusy(true);
    setExiting(true);

    try {
      await wait(REVIEW_TRANSITION_MS);
      await action();
    } finally {
      setExiting(false);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <ReviewCard
        key={activeKey}
        item={activeItem}
        remainingCount={items.length}
        onAnswer={(rating) =>
          runAction(() =>
            activeItem.clozeId
              ? onAnswer(activeItem.kind, activeItem.entry.id, rating, activeItem.clozeId)
              : onAnswer(activeItem.kind, activeItem.entry.id, rating),
          )
        }
        onPostpone={() =>
          runAction(() =>
            activeItem.clozeId
              ? onPostpone(activeItem.kind, activeItem.entry.id, activeItem.clozeId)
              : onPostpone(activeItem.kind, activeItem.entry.id),
          )
        }
        locale={locale}
        busy={busy}
        focusOnMount={focusOnMount}
        transitionClassName={
          exiting ? 'review-card-exit' : 'review-card-enter'
        }
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
  focusOnMount = false,
  transitionClassName = 'review-card-enter',
}: {
  item: SrsQueueItem;
  remainingCount: number;
  onAnswer: (rating: ReviewRating) => void | Promise<void>;
  onPostpone: () => void | Promise<void>;
  locale: UiLocale;
  initiallyRevealed?: boolean;
  busy?: boolean;
  focusOnMount?: boolean;
  transitionClassName?: string;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const { entry } = item;

  // A cloze card: quote with an active clozeId
  const isClozeCard = entry.kind === 'quote' && item.clozeId != null;

  // For word cards and plain quote cards (no clozeId) the old behavior applies.
  // For cloze cards, start hidden like words.
  const [revealed, setRevealed] = useState(
    isClozeCard ? initiallyRevealed : (entry.kind === 'quote' || initiallyRevealed),
  );
  const answerVisible = isClozeCard ? revealed : (entry.kind === 'quote' || revealed);
  const source = getSourceLabel(entry);

  useEffect(() => {
    if (focusOnMount) cardRef.current?.focus();
  }, [focusOnMount]);

  return (
    <article
      ref={cardRef}
      tabIndex={-1}
      aria-busy={busy}
      className={`flex min-h-[420px] flex-col rounded-sm border border-border bg-paper-light p-6 shadow-md outline-none sm:p-8 ${transitionClassName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1 rounded-sm border border-accent-border bg-accent-light px-2 py-1 font-medium text-accent-deep tracking-[1px]">
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
          {entry.kind === 'quote' && entry.tags.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-sm border border-accent-border bg-accent-light px-2 py-1 text-accent-deep"
                >
                  #{tag}
                </span>
              ))}
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

      {entry.kind === 'quote' && !isClozeCard && (
        <div className="flex flex-1 flex-col justify-center py-8">
          <blockquote
            tabIndex={-1}
            className="relative border-l-[3px] border-accent-fade py-3 pl-7 pr-5 text-2xl leading-[2] text-ink tracking-[2px] sm:text-3xl"
          >
            <span
              aria-hidden="true"
              className="absolute left-2 top-1 text-2xl text-accent-deep/40"
            >
              「
            </span>
            <span>{entry.text}</span>
            <span
              aria-hidden="true"
              className="absolute bottom-0 right-1 text-2xl text-accent-deep/40"
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

      {entry.kind === 'quote' && isClozeCard && (
        // No TraditionalButton here: cloze offsets index Simplified text.
        // A Traditional conversion can change string length, causing the
        // offsets to misalign on traditionalText. Intentionally omitted per
        // spec §8 (no offset remapping in v1).
        <ClozeQuoteBody
          quote={entry as QuoteEntry}
          clozeId={item.clozeId!}
          revealed={revealed}
          locale={locale}
        />
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
        {!answerVisible ? (
          <>
            <button
              type="button"
              onClick={() => setRevealed(true)}
              disabled={busy}
              title={t(locale, 'review.revealTitle')}
              className="inline-flex items-center gap-1 rounded-sm bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm tracking-[2px] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
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

// ---------------------------------------------------------------------------
// Cloze body renderer
// ---------------------------------------------------------------------------

function ClozeQuoteBody({
  quote,
  clozeId,
  revealed,
  locale,
}: {
  quote: QuoteEntry;
  clozeId: string;
  revealed: boolean;
  locale: UiLocale;
}) {
  const activeCloze = (quote.clozes ?? []).find((c) => c.id === clozeId);
  const text = quote.text;

  if (!activeCloze) {
    // Fallback: render the full text. No answer known, so hide note until reveal.
    return (
      <div className="flex flex-1 flex-col justify-center py-8">
        <blockquote
          tabIndex={-1}
          className="relative border-l-[3px] border-accent-fade py-3 pl-7 pr-5 text-2xl leading-[2] text-ink tracking-[2px] sm:text-3xl"
        >
          <span aria-hidden="true" className="absolute left-2 top-1 text-2xl text-accent-deep/40">「</span>
          <span>{text}</span>
          <span aria-hidden="true" className="absolute bottom-0 right-1 text-2xl text-accent-deep/40">」</span>
        </blockquote>
        {quote.note && revealed && (
          <p className="mt-5 rounded-sm border border-border bg-paper-input px-4 py-3 text-sm leading-7 text-ink-secondary">
            {quote.note}
          </p>
        )}
      </div>
    );
  }

  const { start, end } = activeCloze;
  const answer = text.slice(start, end);
  const before = text.slice(0, start);
  const after = text.slice(end);

  // Other clozes: render their text as-is (only active one is blanked)
  // We'll render the quote with segments: before | [other clozes that fall before] | blank | after
  // Since clozes don't overlap, the simplest approach is to render the full text
  // split at the active cloze boundaries. Other clozes appear in "before" or "after" as plain text.

  // Note visibility: show after reveal always.
  // On the front, show the note only if it does NOT contain the answer substring
  // (e.g. a mnemonic tip is safe; a note quoting the answer would be a spoiler).
  const showNote = revealed || (!!quote.note && !quote.note.includes(answer));

  if (revealed) {
    return (
      <div className="flex flex-1 flex-col justify-center py-8">
        <blockquote
          tabIndex={-1}
          className="relative border-l-[3px] border-accent-fade py-3 pl-7 pr-5 text-2xl leading-[2] text-ink tracking-[2px] sm:text-3xl"
        >
          <span aria-hidden="true" className="absolute left-2 top-1 text-2xl text-accent-deep/40">「</span>
          <span>
            {before}
            <span className="rounded-sm bg-accent/15 px-0.5 text-accent-deep font-medium">
              {answer}
            </span>
            {after}
          </span>
          <span aria-hidden="true" className="absolute bottom-0 right-1 text-2xl text-accent-deep/40">」</span>
        </blockquote>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm text-muted tracking-[1px]">
            {t(locale, 'review.answer')}:
          </span>
          <span className="text-base font-medium text-accent-deep">
            {toPinyin(answer)}
          </span>
          <SpeakButton text={text} locale={locale} />
        </div>
        {quote.note && showNote && (
          <p className="mt-5 rounded-sm border border-border bg-paper-input px-4 py-3 text-sm leading-7 text-ink-secondary">
            {quote.note}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col justify-center py-8">
      <blockquote
        tabIndex={-1}
        className="relative border-l-[3px] border-accent-fade py-3 pl-7 pr-5 text-2xl leading-[2] text-ink tracking-[2px] sm:text-3xl"
      >
        <span aria-hidden="true" className="absolute left-2 top-1 text-2xl text-accent-deep/40">「</span>
        <span>
          {before}
          <ClozeBlank cloze={activeCloze} answer={answer} locale={locale} />
          {after}
        </span>
        <span aria-hidden="true" className="absolute bottom-0 right-1 text-2xl text-accent-deep/40">」</span>
      </blockquote>
      {quote.note && showNote && (
        <p className="mt-5 rounded-sm border border-border bg-paper-input px-4 py-3 text-sm leading-7 text-ink-secondary">
          {quote.note}
        </p>
      )}
    </div>
  );
}

function ClozeBlank({
  cloze,
  answer,
  locale,
}: {
  cloze: Cloze;
  answer: string;
  locale: UiLocale;
}) {
  const hint = cloze.hint ?? 'none';
  const ariaLabel = t(locale, 'cloze.blankAria');

  if (hint === 'length') {
    return (
      <span
        aria-label={ariaLabel}
        className="inline-flex items-center gap-0.5 align-middle"
      >
        {Array.from(answer).map((_, i) => (
          <span
            key={i}
            data-cloze-box
            className="inline-block h-6 w-6 rounded-sm border-2 border-accent/40 bg-accent/5"
          />
        ))}
      </span>
    );
  }

  if (hint === 'pinyin') {
    const py = toPinyin(answer);
    return (
      <span className="inline-flex flex-col items-center align-middle">
        <span className="text-xs text-muted leading-none pb-0.5">{py}</span>
        <span
          aria-label={ariaLabel}
          className="text-accent-deep/60 font-medium tracking-widest"
        >
          ____
        </span>
      </span>
    );
  }

  // hint === 'none' (default)
  return (
    <span
      aria-label={ariaLabel}
      className="text-accent-deep/60 font-medium tracking-widest"
    >
      ____
    </span>
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
  tone: 'muted' | 'accent' | 'good' | 'easy',
): string {
  switch (tone) {
    case 'muted':
      return 'border border-border bg-transparent text-ink-secondary hover:border-border-hover hover:bg-paper-input';
    case 'accent':
      return 'border border-accent-border bg-accent-light text-accent-deep hover:bg-accent hover:text-white';
    case 'good':
      return 'bg-accent text-white shadow-sm hover:brightness-95';
    case 'easy':
      return 'border border-border bg-paper-input text-ink hover:border-accent-fade';
  }
}

function getSourceLabel(entry: Entry): string {
  if (entry.kind === 'quote') {
    return entry.sourceTitle || entry.sourceDomain;
  }
  const latest = entry.occurrences[entry.occurrences.length - 1];
  return latest?.sourceTitle || latest?.sourceDomain || '';
}
