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
      <div className="py-12 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-jade-50 text-2xl text-jade-700">
          句
        </div>
        <p className="text-sm font-medium text-jade-900">还没有句子</p>
        <p className="mt-1 text-sm text-gray-400">遇到喜欢的句子，就把它夹进这本小手帐。</p>
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
