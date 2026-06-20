import type { QuoteEntry } from '@/lib/types';
import { QuoteCard } from './QuoteCard';

export function QuoteList({
  quotes,
  onUpdate,
  onDelete,
}: {
  quotes: QuoteEntry[];
  onUpdate: (id: string, patch: Partial<QuoteEntry>) => void;
  onDelete: (id: string) => void;
}) {
  if (quotes.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-border bg-paper-light py-12 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center text-[56px] leading-none text-ink/12">
          句
        </div>
        <p className="text-base font-medium text-ink-secondary tracking-[3px]">还没有句子</p>
        <p className="mt-1 text-xs text-muted">遇到喜欢的句子，就把它夹进这本小手帐。</p>
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
        />
      ))}
    </div>
  );
}
