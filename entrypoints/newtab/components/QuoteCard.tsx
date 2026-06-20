import { useState } from 'react';
import { Archive, Check, Trash2 } from 'lucide-react';
import type { QuoteEntry } from '@/lib/types';

export function QuoteCard({
  quote,
  onUpdate,
  onDelete,
}: {
  quote: QuoteEntry;
  onUpdate: (patch: Partial<QuoteEntry>) => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(quote.note);

  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <blockquote className="border-l-2 border-jade-300 pl-3 text-base text-ink">
        「{quote.text}」
      </blockquote>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <input
          value={quote.category}
          onChange={(event) => onUpdate({ category: event.target.value })}
          className="rounded bg-gray-50 px-1 outline-none focus:bg-white"
        />
        {quote.sourceUrl && (
          <a
            href={quote.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-jade-700"
          >
            {quote.sourceTitle || quote.sourceDomain}
          </a>
        )}
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => note !== quote.note && onUpdate({ note })}
        placeholder="note..."
        rows={2}
        className="mt-2 w-full resize-none rounded border p-1 text-xs outline-none focus:border-jade-400"
      />
      <div className="mt-1 flex justify-end gap-1">
        {quote.status !== 'reviewed' && (
          <button
            onClick={() => onUpdate({ status: 'reviewed' })}
            className="rounded p-1 hover:bg-green-50 hover:text-green-600"
          >
            <Check className="h-4 w-4" />
          </button>
        )}
        {quote.status !== 'archived' && (
          <button
            onClick={() => onUpdate({ status: 'archived' })}
            className="rounded p-1 hover:bg-gray-100"
          >
            <Archive className="h-4 w-4" />
          </button>
        )}
        <button onClick={onDelete} className="rounded p-1 hover:bg-red-50 hover:text-red-600">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
