import { useState } from 'react';
import { isParkedQuote } from '@/lib/cloze';
import { formatMessage, t } from '@/lib/i18n';
import type { QuoteEntry, UiLocale, WordEntry } from '@/lib/types';
import { QuoteCard } from './QuoteCard';

export function QuoteList({
  quotes,
  words,
  onUpdate,
  onDelete,
  locale,
}: {
  quotes: QuoteEntry[];
  words: WordEntry[];
  onUpdate: (id: string, patch: Partial<QuoteEntry>) => void;
  onDelete: (id: string) => void;
  locale: UiLocale;
}) {
  const [showParkedOnly, setShowParkedOnly] = useState(false);

  // Non-archived parked count (spec §5: archived parked are intentionally silent)
  const parkedCount = quotes.filter(
    (q) => q.status !== 'archived' && isParkedQuote(q),
  ).length;

  const visible = showParkedOnly
    ? quotes.filter((q) => q.status !== 'archived' && isParkedQuote(q))
    : quotes;

  if (quotes.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-border bg-paper-light py-12 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center text-[56px] leading-none text-ink/12">
          句
        </div>
        <p className="text-base font-medium text-ink-secondary tracking-[3px]">{t(locale, 'quote.emptyTitle')}</p>
        <p className="mt-1 text-xs text-muted">{t(locale, 'quote.emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header: parked count badge + filter toggle */}
      {parkedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-parked-count
            className="inline-flex items-center rounded-sm border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
          >
            {formatMessage(locale, 'cloze.parkedCount', { count: parkedCount })}
          </span>
          <button
            data-parked-filter
            onClick={() => setShowParkedOnly((v) => !v)}
            className={`rounded-sm border px-2 py-0.5 text-xs transition ${
              showParkedOnly
                ? 'border-amber-400 bg-amber-100 font-semibold text-amber-800'
                : 'border-border bg-paper-input text-muted hover:border-amber-300 hover:text-amber-700'
            }`}
          >
            {showParkedOnly ? t(locale, 'filter.all') : t(locale, 'cloze.parked')}
          </button>
        </div>
      )}

      <div className="grid gap-3">
        {visible.map((quote) => (
          <QuoteCard
            key={quote.id}
            quote={quote}
            words={words}
            onUpdate={(patch) => onUpdate(quote.id, patch)}
            onDelete={() => onDelete(quote.id)}
            locale={locale}
            highlightParked={quote.status !== 'archived' && isParkedQuote(quote)}
          />
        ))}
      </div>
    </div>
  );
}
