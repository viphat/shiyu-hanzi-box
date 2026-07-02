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
import { greetingPeriod, t, type MessageKey } from '@/lib/i18n';
import { AutumnBranch, SageBranch } from '@/components/Foliage';
import type {
  AiSettings,
  Entry,
  Inbox as InboxState,
  QuoteEntry,
  ReviewRating,
  Status,
  UiLocale,
  WordEntry,
} from '@/lib/types';
import { getAiSettings, aiSettingsStorage, DEFAULT_AI_SETTINGS } from '@/lib/ai/settings';
import { QuoteList } from './components/QuoteList';
import { ReviewQueue } from './components/ReviewQueue';
import { SyncStatusBadge } from './SyncStatusBadge';
import { Toolbar } from './components/Toolbar';
import { WordList } from './components/WordList';
import { useInbox } from './hooks/useInbox';
import { useSettings } from './hooks/useSettings';
import { requestSyncMutation } from '../background/sync-mutation-handler';
import { wordKey } from '@/lib/sync/project';
import { addTag, planTagWrite, planTagRemovalAcrossQuotes, removeTag, normalizeTag, tagCounts, quoteMatchesTags } from '@/lib/tags';

type Tab = 'review' | 'words' | 'quotes';
type StatusFilter = 'all' | Status;

export function App() {
  const { inbox, loading, mutate, mutateWithRemovals, replace } = useInbox();
  const { settings, loading: settingsLoading } = useSettings();
  const locale = settings.uiLocale;
  const [aiSettings, setAiSettingsState] = useState<AiSettings>(DEFAULT_AI_SETTINGS);

  useEffect(() => {
    let mounted = true;
    void getAiSettings().then((value) => {
      if (mounted) setAiSettingsState(value);
    });
    const unwatch = aiSettingsStorage.watch((next) => {
      if (mounted) setAiSettingsState(next ?? DEFAULT_AI_SETTINGS);
    });
    return () => {
      mounted = false;
      unwatch();
    };
  }, []);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('review');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('inbox');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }
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

  const now = new Date();
  const today = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(now);
  const period = greetingPeriod(now.getHours());
  const greeting = t(locale, `greeting.${period}` as MessageKey);
  const greetingSub = t(
    locale,
    period === 'morning'
      ? 'greeting.subMorning'
      : period === 'afternoon'
        ? 'greeting.subAfternoon'
        : 'greeting.subEvening',
  );

  const matches = useMemo(() => {
    const byStatus = (status: Status) =>
      statusFilter === 'all' || status === statusFilter;
    const quotesByQueryStatus = inbox.quotes.filter(
      (quote) => entryMatchesQuery(quote, normalizedQuery) && byStatus(quote.status),
    );
    return {
      words: inbox.words.filter(
        (word) => entryMatchesQuery(word, normalizedQuery) && byStatus(word.status),
      ),
      quotesByQueryStatus,
      quotes: quotesByQueryStatus.filter((quote) => quoteMatchesTags(quote, selectedTags)),
    };
  }, [inbox, normalizedQuery, statusFilter, selectedTags]);

  const knownTags = useMemo(
    () => [...tagCounts(inbox.quotes).keys()].sort(),
    [inbox.quotes],
  );

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
    mutate((current) => {
      const word = current.words.find((w) => w.id === id);
      if (word) {
        void requestSyncMutation('delete', [wordKey(word.normalized)]);
      }
      return {
        ...current,
        words: current.words.filter((w) => w.id !== id),
      };
    });
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
    void requestSyncMutation('delete', [`quote:${id}`]);
    mutate((current) => ({
      ...current,
      quotes: current.quotes.filter((quote) => quote.id !== id),
    }));
  }

  // The tag write paths plan their `removeTags` tombstones and build the next
  // inbox from a single freshly-read snapshot. Planning off React state while
  // `mutate` re-reads storage would split the two snapshots, so a tag a sync
  // landed between render and click could be mutated locally with no tombstone
  // — silently resurrecting it. Reading once keeps planning and mutation aligned.
  function setQuoteTags(id: string, nextTags: string[]) {
    void mutateWithRemovals((current) => {
      const target = current.quotes.find((q) => q.id === id);
      if (!target) return null;
      const { next, removed } = planTagWrite(target.tags, nextTags);
      return {
        removals: removed.length > 0 ? [{ quoteId: id, tags: removed }] : [],
        inbox: {
          ...current,
          quotes: current.quotes.map((quote) =>
            quote.id === id ? { ...quote, tags: next, updatedAt: Date.now() } : quote,
          ),
        },
      };
    });
  }

  function renameTagEverywhere(from: string, to: string) {
    const fromTag = normalizeTag(from);
    const toTag = normalizeTag(to);
    if (fromTag === '' || toTag === '' || fromTag === toTag) return;
    void mutateWithRemovals((current) => ({
      removals: planTagRemovalAcrossQuotes(current.quotes, fromTag),
      inbox: {
        ...current,
        quotes: current.quotes.map((quote) =>
          quote.tags.includes(fromTag)
            ? { ...quote, tags: addTag(removeTag(quote.tags, fromTag), toTag), updatedAt: Date.now() }
            : quote,
        ),
      },
    }));
  }

  function deleteTagEverywhere(tag: string) {
    const target = normalizeTag(tag);
    if (target === '') return;
    void mutateWithRemovals((current) => ({
      removals: planTagRemovalAcrossQuotes(current.quotes, target),
      inbox: {
        ...current,
        quotes: current.quotes.map((quote) =>
          quote.tags.includes(target)
            ? { ...quote, tags: removeTag(quote.tags, target), updatedAt: Date.now() }
            : quote,
        ),
      },
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
      <header className="px-5 pt-6">
        <div className="mx-auto max-w-5xl">
          <div className="relative overflow-hidden rounded-2xl border border-border-soft bg-banner p-6 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
            <SageBranch className="absolute -bottom-10 -left-8 hidden h-44 w-44 opacity-45 sm:block" />
            <AutumnBranch className="absolute -right-6 -top-10 hidden h-36 w-36 opacity-40 sm:block" />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted tracking-[1px]">
                  拾语汉字box · {today}
                </p>
                <SyncStatusBadge locale={locale} />
              </div>
              <div className="mt-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-[28px] font-bold leading-tight text-ink tracking-[3px]">
                    {greeting}
                  </h1>
                  <p className="mt-1.5 max-w-md text-sm leading-6 text-ink-secondary tracking-[0.5px]">
                    {greetingSub}
                  </p>
                </div>
                <div className="shrink-0 rounded-2xl bg-card p-2 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
                  <img
                    src={iconUrl}
                    alt=""
                    className="h-12 w-12 rounded-[12px]"
                    aria-hidden="true"
                  />
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatChip
                  icon={<BookOpen className="h-4 w-4" />}
                  label={t(locale, 'app.reviewToday')}
                  value={stats.review}
                  emphasize
                />
                <StatChip icon={<Inbox className="h-4 w-4" />} label={t(locale, 'app.inbox')} value={stats.inbox} />
                <StatChip
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label={t(locale, 'app.reviewed')}
                  value={stats.reviewed}
                />
                <StatChip
                  icon={<ScrollText className="h-4 w-4" />}
                  label={t(locale, 'app.archived')}
                  value={stats.archived}
                />
              </div>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-5 py-6">
        <Toolbar
          inbox={inbox}
          query={query}
          onQuery={setQuery}
          onRestore={async (restored) => {
            await replace(restored.inbox);
            if (restored.settings) await requestSyncMutation('settings', restored.settings);
            if (restored.aiSettings) await requestSyncMutation('ai', restored.aiSettings);
          }}
          locale={locale}
          settings={settings}
          aiSettings={aiSettings}
        />

        <SrsStatsPanel stats={srsStats} locale={locale} />

        <div className="rounded-2xl border border-border bg-card-soft p-3 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex gap-1 rounded-full bg-chip p-1">
              {(['review', 'words', 'quotes'] as Tab[]).map((nextTab) => (
                <button
                  key={nextTab}
                  onClick={() => setTab(nextTab)}
                  className={`rounded-full px-4 py-1.5 text-[13px] tracking-[1px] transition ${
                    tab === nextTab
                      ? 'bg-accent font-semibold text-on-accent shadow-sm'
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
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted">
                <BookOpen className="h-4 w-4 text-accent-deep" />
                {t(locale, 'app.reviewToday')}
              </div>
            ) : (
              <label className="inline-flex items-center gap-2 text-sm text-muted">
                <BookOpen className="h-4 w-4 text-accent-deep" />
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-ink outline-none transition focus:border-accent-fade"
                >
                  <option value="inbox">{t(locale, 'app.inbox')}</option>
                  <option value="reviewed">{t(locale, 'app.reviewed')}</option>
                  <option value="archived">{t(locale, 'app.archived')}</option>
                  <option value="all">{t(locale, 'filter.all')}</option>
                </select>
              </label>
            )}
          </div>
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
              cloudQuotes={matches.quotesByQueryStatus}
              onUpdate={updateQuote}
              onDelete={deleteQuote}
              onSetTags={setQuoteTags}
              knownTags={knownTags}
              selectedTags={selectedTags}
              onToggleTag={toggleTag}
              onRenameTag={renameTagEverywhere}
              onDeleteTag={deleteTagEverywhere}
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
      ? `${entry.sourceTitle} ${entry.sourceDomain}`
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

function StatChip({
  icon,
  label,
  value,
  emphasize = false,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] border border-border-soft bg-[#fdfaf2] px-3 py-2.5">
      <span className="shrink-0 text-accent-deep">{icon}</span>
      <div className="min-w-0">
        <div className="truncate text-[11px] tracking-[1px] text-muted">{label}</div>
        <div className={`text-xl font-bold leading-tight ${emphasize ? 'text-accent-strong' : 'text-ink'}`}>
          {value}
        </div>
      </div>
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
    <dl className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card-soft p-3 shadow-[0_1px_3px_rgba(90,75,50,0.06)] sm:grid-cols-5">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="rounded-[14px] border border-border-soft bg-[#fdfaf2] px-3 py-2.5 text-center"
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
