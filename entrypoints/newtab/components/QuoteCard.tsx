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
    <div className="rounded-lg border border-jade-100 bg-[#fbfefc] p-4 shadow-sm transition hover:border-jade-200 hover:shadow-md">
      <blockquote className="border-l-4 border-jade-400 pl-4 text-lg leading-8 text-jade-950">
        「{quote.text}」
      </blockquote>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <input
          value={quote.category}
          onChange={(event) => onUpdate({ category: event.target.value })}
          className="rounded bg-jade-100 px-2 py-1 text-jade-800 outline-none focus:bg-white"
        />
        {quote.sourceUrl && (
          <a
            href={quote.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-white px-2 py-1 hover:text-jade-700"
          >
            {quote.sourceTitle || quote.sourceDomain}
          </a>
        )}
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => note !== quote.note && onUpdate({ note })}
        placeholder="给这句话留一条旁注..."
        rows={2}
        className="mt-3 w-full resize-none rounded-lg border border-jade-100 bg-white p-2 text-xs outline-none focus:border-jade-400"
      />
      <div className="mt-1 flex justify-end gap-1">
        {quote.status !== 'reviewed' && (
          <button
            onClick={() => onUpdate({ status: 'reviewed' })}
            className="rounded p-1 text-gray-400 hover:bg-jade-50 hover:text-jade-700"
          >
            <Check className="h-4 w-4" />
          </button>
        )}
        {quote.status !== 'archived' && (
          <button
            onClick={() => onUpdate({ status: 'archived' })}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <Archive className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onDelete}
          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
