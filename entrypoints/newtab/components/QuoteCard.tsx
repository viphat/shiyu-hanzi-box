import { useState } from 'react';
import { t } from '@/lib/i18n';
import type { QuoteEntry, UiLocale } from '@/lib/types';

export function QuoteCard({
  quote,
  onUpdate,
  onDelete,
  locale,
}: {
  quote: QuoteEntry;
  onUpdate: (patch: Partial<QuoteEntry>) => void;
  onDelete: () => void;
  locale: UiLocale;
}) {
  const [note, setNote] = useState(quote.note);

  return (
    <div className="rounded-sm border border-border bg-paper-light p-4 shadow-sm transition hover:border-border-hover hover:shadow-md">
      <blockquote className="relative border-l-[3px] border-cinnabar-fade py-1 pl-5 pr-4 text-base leading-8 text-ink tracking-[1px]">
        <span aria-hidden="true" className="absolute left-2 top-0 text-xl text-cinnabar/40">
          「
        </span>
        <span>{quote.text}</span>
        <span aria-hidden="true" className="absolute bottom-0 right-1 text-xl text-cinnabar/40">
          」
        </span>
      </blockquote>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <input
          value={quote.category}
          onChange={(event) => onUpdate({ category: event.target.value })}
          className="rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1 text-cinnabar outline-none transition focus:border-cinnabar-fade focus:bg-paper-input"
        />
        {quote.sourceUrl && (
          <a
            href={quote.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm border border-border bg-paper-input px-2 py-1 hover:text-cinnabar"
          >
            {quote.sourceTitle || quote.sourceDomain}
          </a>
        )}
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => note !== quote.note && onUpdate({ note })}
        placeholder={t(locale, 'quote.notePlaceholder')}
        rows={2}
        className="mt-3 w-full resize-none rounded-sm border border-border bg-paper-input p-2 text-xs text-ink outline-none transition placeholder:text-muted focus:border-cinnabar-fade"
      />
      <div className="mt-1 flex justify-end gap-1">
        {quote.status !== 'reviewed' && (
          <button
            onClick={() => onUpdate({ status: 'reviewed' })}
            title={t(locale, 'word.markReviewed')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-cinnabar-border bg-cinnabar-light text-xs font-semibold text-cinnabar transition hover:bg-cinnabar hover:text-white"
          >
            {locale === 'en' ? 'R' : '阅'}
          </button>
        )}
        {quote.status !== 'archived' && (
          <button
            onClick={() => onUpdate({ status: 'archived' })}
            title={t(locale, 'word.archive')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-transparent text-xs font-semibold text-muted transition hover:border-border-hover hover:bg-paper-input hover:text-ink-secondary"
          >
            {locale === 'en' ? 'A' : '档'}
          </button>
        )}
        <button
          onClick={onDelete}
          title={t(locale, 'word.delete')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-transparent text-xs font-semibold text-muted transition hover:border-cinnabar-border hover:bg-cinnabar-light hover:text-cinnabar"
        >
          {locale === 'en' ? 'D' : '删'}
        </button>
      </div>
    </div>
  );
}
