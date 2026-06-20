import { Eye, MessageSquareQuote, Repeat2, SkipForward, WholeWord } from 'lucide-react';
import type { Entry } from '@/lib/types';
import type { ReviewQueueItem } from '@/lib/review';

export function ReviewQueue({
  items,
  onView,
  onSkip,
  onRepeat,
}: {
  items: ReviewQueueItem[];
  onView: (kind: Entry['kind'], id: string) => void;
  onSkip: (kind: Entry['kind'], id: string) => void;
  onRepeat: (kind: Entry['kind'], id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-jade-50 text-2xl text-jade-700">
          习
        </div>
        <p className="text-sm font-medium text-jade-900">今日复习清空了</p>
        <p className="mt-1 text-sm text-gray-400">
          新拾到的词句会先出现在这里，直到你把它们归档。
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <ReviewCard
          key={`${item.kind}:${item.entry.id}`}
          item={item}
          onView={() => onView(item.kind, item.entry.id)}
          onSkip={() => onSkip(item.kind, item.entry.id)}
          onRepeat={() => onRepeat(item.kind, item.entry.id)}
        />
      ))}
    </div>
  );
}

function ReviewCard({
  item,
  onView,
  onSkip,
  onRepeat,
}: {
  item: ReviewQueueItem;
  onView: () => void;
  onSkip: () => void;
  onRepeat: () => void;
}) {
  const { entry } = item;
  const source = getSourceLabel(entry);

  return (
    <article className="rounded-lg border border-jade-100 bg-[#fbfefc] p-4 shadow-sm transition hover:border-jade-200 hover:shadow-md">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1 rounded bg-jade-100 px-2 py-1 font-medium text-jade-800">
          {entry.kind === 'word' ? (
            <WholeWord className="h-3.5 w-3.5" />
          ) : (
            <MessageSquareQuote className="h-3.5 w-3.5" />
          )}
          {entry.kind === 'word' ? 'Word' : 'Quote'}
        </span>
        <span className="rounded bg-white px-2 py-1">
          {entry.status === 'inbox' ? 'Inbox' : 'Review'}
        </span>
        {entry.kind === 'quote' && (
          <span className="rounded bg-white px-2 py-1">{entry.category}</span>
        )}
        {source && <span className="truncate rounded bg-white px-2 py-1">{source}</span>}
      </div>

      {entry.kind === 'word' ? (
        <h2 className="mt-3 text-3xl font-semibold text-jade-950">{entry.text}</h2>
      ) : (
        <blockquote className="mt-3 border-l-4 border-jade-400 pl-4 text-lg leading-8 text-jade-950">
          「{entry.text}」
        </blockquote>
      )}

      {entry.note && (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm leading-6 text-gray-600">
          {entry.note}
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          onClick={onView}
          title="Mark viewed and schedule the next review"
          className="inline-flex items-center gap-1 rounded-lg bg-jade-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-jade-800"
        >
          <Eye className="h-4 w-4" /> View
        </button>
        <button
          onClick={onSkip}
          title="Skip this card until tomorrow"
          className="inline-flex items-center gap-1 rounded-lg border border-jade-100 bg-white px-3 py-2 text-sm font-medium text-jade-800 hover:bg-jade-50"
        >
          <SkipForward className="h-4 w-4" /> Skip
        </button>
        <button
          onClick={onRepeat}
          title="Push this card to the end of today's queue"
          className="inline-flex items-center gap-1 rounded-lg border border-jade-100 bg-white px-3 py-2 text-sm font-medium text-jade-800 hover:bg-jade-50"
        >
          <Repeat2 className="h-4 w-4" /> Repeat
        </button>
      </div>
    </article>
  );
}

function getSourceLabel(entry: Entry): string {
  if (entry.kind === 'quote') {
    return entry.sourceTitle || entry.sourceDomain;
  }

  const latest = entry.occurrences[entry.occurrences.length - 1];
  return latest?.sourceTitle || latest?.sourceDomain || '';
}
