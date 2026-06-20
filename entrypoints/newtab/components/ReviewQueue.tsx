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
      <div className="rounded-sm border border-dashed border-border bg-paper-light py-12 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center text-[56px] leading-none text-ink/12">
          习
        </div>
        <p className="text-base font-medium text-ink-secondary tracking-[3px]">今日复习清空了</p>
        <p className="mt-1 text-xs text-muted">
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
    <article className="rounded-sm border border-border bg-paper-light p-4 shadow-sm transition hover:border-border-hover hover:shadow-md">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1 rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1 font-medium text-cinnabar tracking-[1px]">
          {entry.kind === 'word' ? (
            <WholeWord className="h-3.5 w-3.5" />
          ) : (
            <MessageSquareQuote className="h-3.5 w-3.5" />
          )}
          {entry.kind === 'word' ? '词' : '句'}
        </span>
        <span className="rounded-sm border border-border bg-paper-input px-2 py-1">
          {entry.status === 'inbox' ? '待整理' : '复习中'}
        </span>
        {entry.kind === 'quote' && (
          <span className="rounded-sm border border-border bg-paper-input px-2 py-1">{entry.category}</span>
        )}
        {source && <span className="truncate rounded-sm border border-border bg-paper-input px-2 py-1">{source}</span>}
      </div>

      {entry.kind === 'word' ? (
        <h2 className="mt-3 text-[32px] font-bold leading-none text-ink tracking-[4px]">{entry.text}</h2>
      ) : (
        <blockquote className="relative mt-3 border-l-[3px] border-cinnabar-fade py-1 pl-5 pr-4 text-base leading-8 text-ink tracking-[1px]">
          <span aria-hidden="true" className="absolute left-2 top-0 text-xl text-cinnabar/40">
            「
          </span>
          <span>{entry.text}</span>
          <span aria-hidden="true" className="absolute bottom-0 right-1 text-xl text-cinnabar/40">
            」
          </span>
        </blockquote>
      )}

      {entry.note && (
        <p className="mt-3 rounded-sm border border-border bg-paper-input px-3 py-2 text-sm leading-6 text-ink-secondary">
          {entry.note}
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          onClick={onView}
          title="标记已阅并安排下次复习"
          className="inline-flex items-center gap-1 rounded-sm bg-cinnabar px-3 py-2 text-sm font-medium text-white shadow-sm tracking-[2px] transition hover:brightness-95"
        >
          <Eye className="h-4 w-4" /> 已阅
        </button>
        <button
          onClick={onSkip}
          title="这张卡片明日再看"
          className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-3 py-2 text-sm font-medium text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input"
        >
          <SkipForward className="h-4 w-4" /> 明日
        </button>
        <button
          onClick={onRepeat}
          title="移到今日队尾"
          className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-3 py-2 text-sm font-medium text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input"
        >
          <Repeat2 className="h-4 w-4" /> 稍后
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
