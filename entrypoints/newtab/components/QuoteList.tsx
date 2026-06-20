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
    return <p className="py-8 text-center text-sm text-gray-400">No quotes yet.</p>;
  }

  return (
    <div className="space-y-2">
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
