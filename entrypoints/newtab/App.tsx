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

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

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
    <div className="min-h-screen bg-gray-50 text-ink">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <h1 className="text-xl font-semibold text-jade-700">拾语汉字box</h1>
          <p className="text-sm text-gray-500">
            {inbox.words.length} words · {inbox.quotes.length} quotes
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-6 py-6">
        <Toolbar inbox={inbox} query={query} onQuery={setQuery} />

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-white p-0.5">
            {(['words', 'quotes'] as Tab[]).map((nextTab) => (
              <button
                key={nextTab}
                onClick={() => setTab(nextTab)}
                className={`rounded px-3 py-1 text-sm ${
                  tab === nextTab ? 'bg-jade-600 text-white' : 'text-gray-600'
                }`}
              >
                {nextTab === 'words'
                  ? `Words (${inbox.words.length})`
                  : `Quotes (${inbox.quotes.length})`}
              </button>
            ))}
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="rounded-lg border bg-white px-2 py-1 text-sm"
          >
            <option value="inbox">Inbox</option>
            <option value="reviewed">Reviewed</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </div>

        {tab === 'words' ? (
          <WordList words={matches.words} onUpdate={updateWord} onDelete={deleteWord} />
        ) : (
          <QuoteList
            quotes={matches.quotes}
            onUpdate={updateQuote}
            onDelete={deleteQuote}
          />
        )}
      </main>
    </div>
  );
}
