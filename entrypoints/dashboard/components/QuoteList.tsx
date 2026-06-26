import type { QuoteEntry, UiLocale, WordEntry } from '@/lib/types';
import { t } from '@/lib/i18n';
import { QuoteCard } from './QuoteCard';

export function QuoteList({
  quotes,
  onUpdate,
  onDelete,
  locale,
  savedWords,
}: {
  quotes: QuoteEntry[];
  onUpdate: (id: string, patch: Partial<QuoteEntry>) => void;
  onDelete: (id: string) => void;
  locale: UiLocale;
  savedWords: WordEntry[];
}) {
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
    <div className="grid gap-3">
      {quotes.map((quote) => (
        <QuoteCard
          key={quote.id}
          quote={quote}
          onUpdate={(patch) => onUpdate(quote.id, patch)}
          onDelete={() => onDelete(quote.id)}
          locale={locale}
          savedWords={savedWords}
        />
      ))}
    </div>
  );
}
