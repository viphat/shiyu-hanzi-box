import { useState } from 'react';
import { countParkedQuotes, isParkedQuote } from '@/lib/cloze';
import { formatMessage, t } from '@/lib/i18n';
import type { QuoteEntry, UiLocale } from '@/lib/types';
import { QuoteCard } from './QuoteCard';

export function QuoteList({
  quotes,
  onUpdate,
  onDelete,
  locale,
}: {
  quotes: QuoteEntry[];
  onUpdate: (id: string, patch: Partial<QuoteEntry>) => void;
  onDelete: (id: string) => void;
  locale: UiLocale;
}) {
  const [showParkedOnly, setShowParkedOnly] = useState(false);

  const parkedCount = countParkedQuotes(quotes);
  const visibleQuotes = showParkedOnly ? quotes.filter(isParkedQuote) : quotes;

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

  const showFilterBar = parkedCount > 0 || showParkedOnly;

  return (
    <div className="space-y-3">
      {showFilterBar && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowParkedOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-medium transition ${
              showParkedOnly
                ? 'border-cinnabar-border bg-cinnabar text-white'
                : 'border-cinnabar-border bg-cinnabar-light text-cinnabar hover:bg-cinnabar hover:text-white'
            }`}
          >
            {t(locale, 'cloze.parked')}
          </button>
          {parkedCount > 0 && (
            <span className="text-xs text-muted">
              {formatMessage(locale, 'cloze.parkedCount', { count: parkedCount })}
            </span>
          )}
        </div>
      )}
      {showParkedOnly && visibleQuotes.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border bg-paper-light py-8 text-center">
          <p className="text-sm text-muted">{t(locale, 'cloze.noParked')}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {visibleQuotes.map((quote) => (
            <QuoteCard
              key={quote.id}
              quote={quote}
              onUpdate={(patch) => onUpdate(quote.id, patch)}
              onDelete={() => onDelete(quote.id)}
              locale={locale}
              showParkedMarker={isParkedQuote(quote)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
