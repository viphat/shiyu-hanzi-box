import { BookOpen, CheckCircle2, Inbox, ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import iconUrl from '../../assets/icon.png';
import {
  buildReviewQueue,
  repeatReview,
  skipReview,
  viewReview,
} from '@/lib/review';
import type { Entry, Inbox as InboxState, QuoteEntry, Status, WordEntry } from '@/lib/types';
import { QuoteList } from './components/QuoteList';
import { ReviewQueue } from './components/ReviewQueue';
import { Toolbar } from './components/Toolbar';
import { WordList } from './components/WordList';
import { useInbox } from './hooks/useInbox';

type Tab = 'review' | 'words' | 'quotes';
type StatusFilter = 'all' | Status;

export function App() {
  const { inbox, loading, mutate, replace } = useInbox();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('review');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('inbox');
  const normalizedQuery = query.trim().toLowerCase();
  const today = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());

  const matches = useMemo(() => {
    const byStatus = (status: Status) =>
      statusFilter === 'all' || status === statusFilter;

    return {
      words: inbox.words.filter(
        (word) => entryMatchesQuery(word, normalizedQuery) && byStatus(word.status),
      ),
      quotes: inbox.quotes.filter(
        (quote) =>
          entryMatchesQuery(quote, normalizedQuery) && byStatus(quote.status),
      ),
    };
  }, [inbox, normalizedQuery, statusFilter]);

  const reviewItems = useMemo(
    () =>
      buildReviewQueue(inbox).filter((item) =>
        entryMatchesQuery(item.entry, normalizedQuery),
      ),
    [inbox, normalizedQuery],
  );

  const reviewDueCount = useMemo(() => buildReviewQueue(inbox).length, [inbox]);

  const stats = useMemo(() => {
    const entries = [...inbox.words, ...inbox.quotes];
    return {
      review: reviewDueCount,
      inbox: entries.filter((entry) => entry.status === 'inbox').length,
      reviewed: entries.filter((entry) => entry.status === 'reviewed').length,
      archived: entries.filter((entry) => entry.status === 'archived').length,
    };
  }, [inbox, reviewDueCount]);

  if (loading) {
    return (
      <div className="min-h-screen p-8 text-sm text-ink-secondary">
        正在翻开收藏箱...
      </div>
    );
  }

  function updateWord(id: string, patch: Partial<WordEntry>) {
    mutate((current) => ({
      ...current,
      words: current.words.map((word) =>
        word.id === id ? { ...word, ...patch, updatedAt: Date.now() } : word,
      ),
    }));
  }

  function deleteWord(id: string) {
    mutate((current) => ({
      ...current,
      words: current.words.filter((word) => word.id !== id),
    }));
  }

  function updateQuote(id: string, patch: Partial<QuoteEntry>) {
    mutate((current) => ({
      ...current,
      quotes: current.quotes.map((quote) =>
        quote.id === id ? { ...quote, ...patch, updatedAt: Date.now() } : quote,
      ),
    }));
  }

  function deleteQuote(id: string) {
    mutate((current) => ({
      ...current,
      quotes: current.quotes.filter((quote) => quote.id !== id),
    }));
  }

  function viewEntry(kind: Entry['kind'], id: string) {
    const now = Date.now();
    mutate((current) =>
      updateReviewEntry(current, kind, id, (entry) => viewReview(entry, now)),
    );
  }

  function skipEntry(kind: Entry['kind'], id: string) {
    const now = Date.now();
    mutate((current) =>
      updateReviewEntry(current, kind, id, (entry) => skipReview(entry, now)),
    );
  }

  function repeatEntry(kind: Entry['kind'], id: string) {
    const now = Date.now();
    mutate((current) => {
      const queueRank =
        Math.max(
          now,
          ...buildReviewQueue(current, now).map(
            (item) => item.entry.review?.queueRank ?? now,
          ),
        ) + 1;

      return updateReviewEntry(current, kind, id, (entry) =>
        repeatReview(entry, now, queueRank),
      );
    });
  }

  return (
    <div className="min-h-screen text-ink">
      <header className="cinnabar-header-accent border-b-2 border-border-strong bg-paper-light">
        <div className="mx-auto max-w-5xl px-5 py-6">
          <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="text-xs font-medium text-muted tracking-[2px]">
                今日拾语 · {today}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <img
                  src={iconUrl}
                  alt=""
                  className="h-11 w-11 rounded-sm"
                  aria-hidden="true"
                />
                <h1 className="text-[26px] font-bold leading-none text-ink tracking-[6px]">
                  拾语汉字box
                </h1>
              </div>
              <p className="mt-2 max-w-xl text-xs leading-6 text-muted tracking-[2px]">
                把网页里遇见的词语和句子收进一本轻巧的中文阅读手帐。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              <StatCard
                icon={<BookOpen className="h-4 w-4" />}
                label="今日复习"
                value={stats.review}
              />
              <StatCard icon={<Inbox className="h-4 w-4" />} label="待整理" value={stats.inbox} />
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="复习中"
                value={stats.reviewed}
              />
              <StatCard
                icon={<ScrollText className="h-4 w-4" />}
                label="已归档"
                value={stats.archived}
              />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-5 py-6">
        <Toolbar
          inbox={inbox}
          query={query}
          onQuery={setQuery}
          onRestore={replace}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong pb-3">
          <div className="flex gap-1">
            {(['review', 'words', 'quotes'] as Tab[]).map((nextTab) => (
              <button
                key={nextTab}
                onClick={() => setTab(nextTab)}
                className={`relative px-4 py-2 text-[13px] tracking-[2px] transition ${
                  tab === nextTab
                    ? "font-semibold text-ink after:absolute after:-bottom-[13px] after:left-1/2 after:h-0.5 after:w-9 after:-translate-x-1/2 after:bg-cinnabar-fade after:content-['']"
                    : 'text-muted hover:text-ink-secondary'
                }`}
              >
                {getTabLabel(nextTab, {
                  review: reviewDueCount,
                  words: inbox.words.length,
                  quotes: inbox.quotes.length,
                })}
              </button>
            ))}
          </div>
          {tab === 'review' ? (
            <div className="inline-flex items-center gap-2 rounded-sm border border-border bg-paper-light px-3 py-2 text-sm text-muted shadow-sm">
              <BookOpen className="h-4 w-4 text-cinnabar" />
              今日温习
            </div>
          ) : (
            <label className="inline-flex items-center gap-2 text-sm text-muted">
              <BookOpen className="h-4 w-4 text-cinnabar" />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink shadow-sm outline-none transition focus:border-cinnabar-fade"
              >
                <option value="inbox">待整理</option>
                <option value="reviewed">复习中</option>
                <option value="archived">已归档</option>
                <option value="all">全部</option>
              </select>
            </label>
          )}
        </div>

        <div className="bamboo-divider" aria-hidden="true">
          ◇ ◇ ◇
        </div>

        <section>
          {tab === 'review' ? (
            <ReviewQueue
              items={reviewItems}
              onView={viewEntry}
              onSkip={skipEntry}
              onRepeat={repeatEntry}
            />
          ) : tab === 'words' ? (
            <WordList words={matches.words} onUpdate={updateWord} onDelete={deleteWord} />
          ) : (
            <QuoteList
              quotes={matches.quotes}
              onUpdate={updateQuote}
              onDelete={deleteQuote}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function updateReviewEntry(
  inbox: InboxState,
  kind: Entry['kind'],
  id: string,
  update: (entry: Entry) => Entry,
): InboxState {
  if (kind === 'word') {
    return {
      ...inbox,
      words: inbox.words.map((word) =>
        word.id === id ? (update(word) as WordEntry) : word,
      ),
    };
  }

  return {
    ...inbox,
    quotes: inbox.quotes.map((quote) =>
      quote.id === id ? (update(quote) as QuoteEntry) : quote,
    ),
  };
}

function entryMatchesQuery(entry: Entry, query: string): boolean {
  if (query === '') return true;

  const source =
    entry.kind === 'quote'
      ? `${entry.category} ${entry.sourceTitle} ${entry.sourceDomain}`
      : entry.occurrences
          .map((occurrence) => `${occurrence.sourceTitle} ${occurrence.sourceDomain}`)
          .join(' ');

  return `${entry.text} ${entry.note} ${entry.tags.join(' ')} ${source}`
    .toLowerCase()
    .includes(query);
}

function getTabLabel(tab: Tab, counts: Record<Tab, number>): string {
  if (tab === 'review') return `温习 (${counts.review})`;
  if (tab === 'words') return `词语 (${counts.words})`;
  return `句子 (${counts.quotes})`;
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-sm border border-border bg-paper-light px-4 py-3 text-ink">
      <div className="mx-auto flex w-fit items-center gap-1 text-muted">
        {icon}
        <span className="text-[11px] tracking-[1px]">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
