import { BookOpen, CheckCircle2, Inbox, ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import type { QuoteEntry, Status, WordEntry } from '@/lib/types';
import { QuoteList } from './components/QuoteList';
import { Toolbar } from './components/Toolbar';
import { WordList } from './components/WordList';
import { useInbox } from './hooks/useInbox';

type Tab = 'words' | 'quotes';
type StatusFilter = 'all' | Status;

export function App() {
  const { inbox, loading, mutate } = useInbox();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('words');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('inbox');
  const today = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());

  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const test = (text: string) =>
      normalizedQuery === '' || text.toLowerCase().includes(normalizedQuery);
    const byStatus = (status: Status) =>
      statusFilter === 'all' || status === statusFilter;

    return {
      words: inbox.words.filter((word) => test(word.text) && byStatus(word.status)),
      quotes: inbox.quotes.filter(
        (quote) =>
          (test(quote.text) || test(quote.category)) && byStatus(quote.status),
      ),
    };
  }, [inbox, query, statusFilter]);

  const stats = useMemo(() => {
    const entries = [...inbox.words, ...inbox.quotes];
    return {
      inbox: entries.filter((entry) => entry.status === 'inbox').length,
      reviewed: entries.filter((entry) => entry.status === 'reviewed').length,
      archived: entries.filter((entry) => entry.status === 'archived').length,
    };
  }, [inbox]);

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

  return (
    <div className="min-h-screen bg-[#f6fbf8] text-ink">
      <header className="border-b border-jade-100 bg-white">
        <div className="mx-auto max-w-5xl px-5 py-6">
          <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="text-xs font-medium uppercase text-jade-600">
                今日拾语 · {today}
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-jade-900">
                拾语汉字box
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-gray-500">
                把网页里遇见的词语和句子收进一本轻巧的中文阅读手帐。
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <StatCard icon={<Inbox className="h-4 w-4" />} label="待整理" value={stats.inbox} />
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="已复习"
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
        <Toolbar inbox={inbox} query={query} onQuery={setQuery} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-jade-100 pb-3">
          <div className="flex rounded-lg border border-jade-100 bg-white p-1 shadow-sm">
            {(['words', 'quotes'] as Tab[]).map((nextTab) => (
              <button
                key={nextTab}
                onClick={() => setTab(nextTab)}
                className={`rounded px-4 py-2 text-sm font-medium transition ${
                  tab === nextTab
                    ? 'bg-jade-700 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-jade-50 hover:text-jade-800'
                }`}
              >
                {nextTab === 'words'
                  ? `Words (${inbox.words.length})`
                  : `Quotes (${inbox.quotes.length})`}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-500">
            <BookOpen className="h-4 w-4 text-jade-600" />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="rounded-lg border border-jade-100 bg-white px-3 py-2 text-sm text-ink shadow-sm outline-none focus:border-jade-400"
            >
              <option value="inbox">Inbox</option>
              <option value="reviewed">Reviewed</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>

        <section className="rounded-lg border border-jade-100 bg-white/80 p-3 shadow-sm">
          {tab === 'words' ? (
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
