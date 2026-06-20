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
      <div className="min-h-screen bg-[#f6fbf8] p-8 text-sm text-jade-700">
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
    <div className="min-h-screen bg-[#f6fbf8] text-ink">
      <header className="border-b border-jade-100 bg-white">
        <div className="mx-auto max-w-5xl px-5 py-6">
          <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="text-xs font-medium uppercase text-jade-600">
                今日拾语 · {today}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <img
                  src={iconUrl}
                  alt=""
                  className="h-11 w-11 rounded-lg"
                  aria-hidden="true"
                />
                <h1 className="text-3xl font-semibold text-jade-900">
                  拾语汉字box
                </h1>
              </div>
              <p className="mt-2 max-w-xl text-sm leading-6 text-gray-500">
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-jade-100 pb-3">
          <div className="flex rounded-lg border border-jade-100 bg-white p-1 shadow-sm">
            {(['review', 'words', 'quotes'] as Tab[]).map((nextTab) => (
              <button
                key={nextTab}
                onClick={() => setTab(nextTab)}
                className={`rounded px-4 py-2 text-sm font-medium transition ${
                  tab === nextTab
                    ? 'bg-jade-700 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-jade-50 hover:text-jade-800'
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
            <div className="inline-flex items-center gap-2 rounded-lg border border-jade-100 bg-white px-3 py-2 text-sm text-gray-500 shadow-sm">
              <BookOpen className="h-4 w-4 text-jade-600" />
              Today&apos;s Queue
            </div>
          ) : (
            <label className="inline-flex items-center gap-2 text-sm text-gray-500">
              <BookOpen className="h-4 w-4 text-jade-600" />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="rounded-lg border border-jade-100 bg-white px-3 py-2 text-sm text-ink shadow-sm outline-none focus:border-jade-400"
              >
                <option value="inbox">Inbox</option>
                <option value="reviewed">Review</option>
                <option value="archived">Archived</option>
                <option value="all">All</option>
              </select>
            </label>
          )}
        </div>

        <section className="rounded-lg border border-jade-100 bg-white/80 p-3 shadow-sm">
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
  if (tab === 'review') return `Review (${counts.review})`;
  if (tab === 'words') return `Words (${counts.words})`;
  return `Quotes (${counts.quotes})`;
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
    <div className="rounded-lg border border-jade-100 bg-jade-50 px-4 py-3 text-jade-900">
      <div className="mx-auto flex w-fit items-center gap-1 text-jade-700">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
