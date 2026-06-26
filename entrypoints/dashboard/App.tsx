import { BookOpen, CheckCircle2, Inbox, ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import iconUrl from '../../assets/icon.png';
import {
  answerReview,
  answerReviewCloze,
  buildSrsQueue,
  getNextSrsWakeAt,
  getSrsStats,
  postponeReview,
  postponeReviewCloze,
  startOfNextDay,
  type SrsQueueItem,
  type SrsStats,
} from '@/lib/srs';
import { t } from '@/lib/i18n';
import type {
  Entry,
  Inbox as InboxState,
  QuoteEntry,
  ReviewRating,
  Status,
  UiLocale,
  WordEntry,
} from '@/lib/types';
import { QuoteList } from './components/QuoteList';
import { ReviewQueue } from './components/ReviewQueue';
import { SyncStatusBadge } from './SyncStatusBadge';
import { Toolbar } from './components/Toolbar';
import { WordList } from './components/WordList';
import { useInbox } from './hooks/useInbox';
import { useSettings } from './hooks/useSettings';

type Tab = 'review' | 'words' | 'quotes';
type StatusFilter = 'all' | Status;

export function App() {
  const { inbox, loading, mutate, replace } = useInbox();
  const { settings, loading: settingsLoading } = useSettings();
  const locale = settings.uiLocale;
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('review');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('inbox');
  const [reviewNow, setReviewNow] = useState(() => Date.now());
  const normalizedQuery = query.trim().toLowerCase();
  const nextSrsWakeAt = useMemo(
    () => getNextSrsWakeAt(inbox, reviewNow),
    [inbox, reviewNow],
  );

  useEffect(() => {
    const delay = Math.max(250, nextSrsWakeAt - Date.now());
    const timer = window.setTimeout(
      () => setReviewNow(Date.now()),
      Math.min(delay, 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
  }, [nextSrsWakeAt]);

  const today = new Intl.DateTimeFormat(locale, {
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

  const srsSnapshot = useMemo(() => {
    const items = buildSrsQueue(inbox, reviewNow, settings.srs);
    return {
      items,
      stats: getSrsStats(inbox, reviewNow, settings.srs, items.length),
    };
  }, [inbox, reviewNow, settings.srs]);

  const allReviewItems: SrsQueueItem[] = srsSnapshot.items;
  const srsStats: SrsStats = srsSnapshot.stats;

  const reviewItems = useMemo(
    () =>
      allReviewItems.filter((item) =>
        entryMatchesQuery(item.entry, normalizedQuery),
      ),
    [allReviewItems, normalizedQuery],
  );

  const reviewDueCount = allReviewItems.length;

  const stats = useMemo(() => {
    const entries = [...inbox.words, ...inbox.quotes];
    return {
      review: reviewDueCount,
      inbox: entries.filter((entry) => entry.status === 'inbox').length,
      reviewed: entries.filter((entry) => entry.status === 'reviewed').length,
      archived: entries.filter((entry) => entry.status === 'archived').length,
    };
  }, [inbox, reviewDueCount]);

  if (loading || settingsLoading) {
    return (
      <div className="min-h-screen p-8 text-sm text-ink-secondary">
        {t(locale, 'app.loading')}
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

  function answerEntry(
    kind: Entry['kind'],
    id: string,
    rating: ReviewRating,
    clozeId?: string,
  ): Promise<void> {
    const now = Date.now();
    return mutate((current) =>
      updateReviewEntry(current, kind, id, (entry) => {
        if (kind === 'quote' && clozeId) {
          return answerReviewCloze(entry as QuoteEntry, clozeId, rating, now, settings.srs);
        }
        return answerReview(entry, rating, now, settings.srs);
      }),
    );
  }

  function postponeEntry(
    kind: Entry['kind'],
    id: string,
    clozeId?: string,
  ): Promise<void> {
    const now = Date.now();
    const dueAt = startOfNextDay(now);
    return mutate((current) =>
      updateReviewEntry(current, kind, id, (entry) => {
        if (kind === 'quote' && clozeId) {
          return postponeReviewCloze(entry as QuoteEntry, clozeId, now, dueAt);
        }
        return postponeReview(entry, now, dueAt);
      }),
    );
  }

  return (
    <div className="min-h-screen text-ink">
      <header className="cinnabar-header-accent border-b-2 border-border-strong bg-paper-light">
        <div className="mx-auto max-w-5xl px-5 py-6">
          <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted tracking-[2px]">
                  {t(locale, 'app.todayPrefix')} · {today}
                </p>
                <SyncStatusBadge locale={locale} />
              </div>
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
                {t(locale, 'app.subtitle')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              <StatCard
                icon={<BookOpen className="h-4 w-4" />}
                label={t(locale, 'app.reviewToday')}
                value={stats.review}
              />
              <StatCard icon={<Inbox className="h-4 w-4" />} label={t(locale, 'app.inbox')} value={stats.inbox} />
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label={t(locale, 'app.reviewed')}
                value={stats.reviewed}
              />
              <StatCard
                icon={<ScrollText className="h-4 w-4" />}
                label={t(locale, 'app.archived')}
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
          locale={locale}
        />

        <SrsStatsPanel stats={srsStats} locale={locale} />

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
                }, locale)}
              </button>
            ))}
          </div>
          {tab === 'review' ? (
            <div className="inline-flex items-center gap-2 rounded-sm border border-border bg-paper-light px-3 py-2 text-sm text-muted shadow-sm">
              <BookOpen className="h-4 w-4 text-cinnabar" />
              {t(locale, 'app.reviewToday')}
            </div>
          ) : (
            <label className="inline-flex items-center gap-2 text-sm text-muted">
              <BookOpen className="h-4 w-4 text-cinnabar" />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink shadow-sm outline-none transition focus:border-cinnabar-fade"
              >
                <option value="inbox">{t(locale, 'app.inbox')}</option>
                <option value="reviewed">{t(locale, 'app.reviewed')}</option>
                <option value="archived">{t(locale, 'app.archived')}</option>
                <option value="all">{t(locale, 'filter.all')}</option>
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
              onAnswer={answerEntry}
              onPostpone={postponeEntry}
              locale={locale}
            />
          ) : tab === 'words' ? (
            <WordList words={matches.words} onUpdate={updateWord} onDelete={deleteWord} locale={locale} />
          ) : (
            <QuoteList
              quotes={matches.quotes}
              onUpdate={updateQuote}
              onDelete={deleteQuote}
              locale={locale}
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

  const tags = entry.kind === 'quote' ? entry.tags.join(' ') : '';
  const source =
    entry.kind === 'quote'
      ? `${entry.category} ${entry.sourceTitle} ${entry.sourceDomain}`
      : entry.occurrences
          .map((occurrence) => `${occurrence.sourceTitle} ${occurrence.sourceDomain}`)
          .join(' ');

  return `${entry.text} ${entry.note} ${tags} ${source}`
    .toLowerCase()
    .includes(query);
}

function getTabLabel(tab: Tab, counts: Record<Tab, number>, locale: UiLocale): string {
  if (tab === 'review') return `${t(locale, 'tab.review')} (${counts.review})`;
  if (tab === 'words') return `${t(locale, 'tab.words')} (${counts.words})`;
  return `${t(locale, 'tab.quotes')} (${counts.quotes})`;
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

function SrsStatsPanel({
  stats,
  locale,
}: {
  stats: SrsStats;
  locale: UiLocale;
}) {
  const items = [
    [t(locale, 'srs.dueNow'), String(stats.dueNow)],
    [t(locale, 'srs.dueLaterToday'), String(stats.dueLaterToday)],
    [t(locale, 'srs.newAvailableToday'), String(stats.newAvailableToday)],
    [t(locale, 'srs.reviewedToday'), String(stats.reviewedToday)],
    [
      t(locale, 'srs.retention'),
      stats.retention === null
        ? '—'
        : `${Math.round(stats.retention * 100)}%`,
    ],
  ] as const;

  return (
    <dl className="grid gap-2 rounded-sm border border-border bg-paper-light p-3 text-center sm:grid-cols-5">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="rounded-sm bg-paper-input px-2 py-2"
        >
          <dt className="text-[11px] tracking-[1px] text-muted">
            {label}
          </dt>
          <dd className="mt-1 text-lg font-semibold text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
