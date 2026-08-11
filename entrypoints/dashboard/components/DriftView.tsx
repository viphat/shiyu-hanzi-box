import { ThumbsDown, ThumbsUp, SkipForward, Undo2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  buildDriftPool,
  driftKey,
  getLevel,
  pickDriftCard,
  recentWindowSize,
  MAX_DRIFT_LEVEL,
  MIN_DRIFT_LEVEL,
  type DriftLevel,
  type DriftStore,
} from '@/lib/drift';
import { formatMessage, t } from '@/lib/i18n';
import { toPinyin } from '@/lib/pinyin';
import { localDayKey } from '@/lib/srs';
import type { AppSettings, Entry, QuoteEntry, UiLocale, WordEntry } from '@/lib/types';
import { ReviewInsightReveal } from './ReviewInsightReveal';
import { SpeakButton } from './SpeakButton';

/** What Back needs to fully undo one advance. */
interface DriftHistoryItem {
  entry: Entry;
  /** The level before the tap. Restored verbatim, so clamped taps undo correctly. */
  previousLevel: DriftLevel;
  /** The local day the advance was counted on, so a session across midnight undoes the right one. */
  dayKey: string;
  /**
   * `recent` exactly as it was immediately before this advance. `recent` is a
   * capped sliding window (`pickDriftCard`'s no-repeat ring), not a plain
   * growing stack, so once it starts evicting, popping its last element on
   * Back can't recover the evicted key. Snapshotting it here — and restoring
   * it verbatim in `back()` — sidesteps that entirely, the same way
   * `previousLevel` sidesteps computing an inverse nudge.
   */
  recentBefore: string[];
}

export function DriftView({
  inbox,
  store,
  onThumb,
  onSkip,
  onBack,
  locale,
  dictionaryCacheKey = 'default',
  dictionarySettings,
  random = Math.random,
  now = Date.now,
}: {
  inbox: { words: WordEntry[]; quotes: QuoteEntry[] };
  store: DriftStore;
  onThumb: (
    entry: Entry,
    delta: 1 | -1,
    previousLevel: DriftLevel,
    dayKey: string,
  ) => void | Promise<void>;
  onSkip: (dayKey: string) => void | Promise<void>;
  onBack: (entry: Entry, previousLevel: DriftLevel, dayKey: string) => void | Promise<void>;
  locale: UiLocale;
  dictionaryCacheKey?: string;
  dictionarySettings?: AppSettings;
  random?: () => number;
  now?: () => number;
}) {
  const pool = useMemo(() => buildDriftPool(inbox), [inbox]);

  const [current, setCurrent] = useState<Entry | null>(() =>
    pickDriftCard(pool, store, [], random),
  );
  const [recent, setRecent] = useState<string[]>([]);
  const [history, setHistory] = useState<DriftHistoryItem[]>([]);
  // Stops a second click from firing onThumb/onSkip/onBack again while the
  // first one is still in flight (see ReviewQueue's `busy`, which the three
  // action buttons here otherwise have no equivalent of). `busy` state drives
  // the `disabled` attribute; `busyRef` is the actual gate — a click handler
  // reads state as of the *last render*, so two clicks arriving before React
  // re-renders would both see `busy === false` no matter when `setBusy(true)`
  // is called. The ref is mutated immediately, so it closes that gap too.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // The pool can change under us (an entry archived in another tab, or a note
  // added elsewhere). Fall back deterministically rather than drawing during
  // render — calling the RNG in render would pick a different card on every
  // re-render. Derive from the pool by key rather than reusing `current`
  // directly, so an entry edited elsewhere is shown fresh rather than stale.
  const currentKey = current ? driftKey(current) : null;
  const activeFromPool =
    currentKey !== null ? (pool.find((entry) => driftKey(entry) === currentKey) ?? null) : null;
  const active = activeFromPool ?? pool[0] ?? null;

  if (pool.length === 0 || !active) {
    return (
      <div className="rounded-2xl border border-border bg-card-soft p-10 text-center shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
        <p className="text-base text-ink">{t(locale, 'drift.emptyTitle')}</p>
        <p className="mt-2 text-sm text-muted">{t(locale, 'drift.emptyBody')}</p>
      </div>
    );
  }

  function advance(item: Omit<DriftHistoryItem, 'recentBefore'>) {
    const key = driftKey(item.entry);
    // Snapshot `recent` as it stood before this advance — copied, not the
    // live reference — so `back()` can restore it verbatim even after the
    // window has evicted keys a plain `slice(0, -1)` could never recover.
    const recentBefore = [...recent];
    const nextRecent = [...recentBefore, key].slice(-Math.max(1, recentWindowSize(pool.length)));
    setHistory((prev) => [...prev, { ...item, recentBefore }]);
    setRecent(() => nextRecent);
    setCurrent(pickDriftCard(pool, store, nextRecent, random));
  }

  function thumb(delta: 1 | -1) {
    if (busyRef.current || !active) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const dayKey = localDayKey(now());
      const previousLevel = getLevel(store, driftKey(active));
      void onThumb(active, delta, previousLevel, dayKey);
      advance({ entry: active, previousLevel, dayKey });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function skip() {
    if (busyRef.current || !active) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const dayKey = localDayKey(now());
      void onSkip(dayKey);
      advance({ entry: active, previousLevel: getLevel(store, driftKey(active)), dayKey });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function back() {
    if (busyRef.current) return;
    const last = history[history.length - 1];
    if (!last) return;
    busyRef.current = true;
    setBusy(true);
    try {
      void onBack(last.entry, last.previousLevel, last.dayKey);
      setHistory((prev) => prev.slice(0, -1));
      setRecent(() => last.recentBefore);
      setCurrent(last.entry);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <DriftCard
        entry={active}
        level={getLevel(store, driftKey(active))}
        locale={locale}
        dictionaryCacheKey={dictionaryCacheKey}
        dictionarySettings={dictionarySettings}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
        {history.length > 0 ? (
          <button
            data-testid="drift-back"
            onClick={back}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted transition hover:text-ink-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Undo2 className="h-4 w-4" />
            {t(locale, 'drift.back')}
          </button>
        ) : (
          <span />
        )}

        <div className="inline-flex gap-2">
          <button
            data-testid="drift-down"
            onClick={() => thumb(-1)}
            title={t(locale, 'drift.seeLess')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card-soft px-4 py-1.5 text-sm text-ink-secondary transition hover:border-accent-fade disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ThumbsDown className="h-4 w-4" />
            {t(locale, 'drift.seeLess')}
          </button>
          <button
            data-testid="drift-skip"
            onClick={skip}
            title={t(locale, 'drift.skip')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm text-muted transition hover:text-ink-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SkipForward className="h-4 w-4" />
            {t(locale, 'drift.skip')}
          </button>
          <button
            data-testid="drift-up"
            onClick={() => thumb(1)}
            title={t(locale, 'drift.seeMore')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent shadow-sm transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ThumbsUp className="h-4 w-4" />
            {t(locale, 'drift.seeMore')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DriftCard({
  entry,
  level,
  locale,
  dictionaryCacheKey = 'default',
  dictionarySettings,
}: {
  entry: Entry;
  level: DriftLevel;
  locale: UiLocale;
  dictionaryCacheKey?: string;
  dictionarySettings?: AppSettings;
}) {
  return (
    <article className="rounded-2xl border border-border bg-card p-6 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full bg-chip px-3 py-1 text-[11px] tracking-[1px] text-muted">
          {t(locale, entry.kind === 'word' ? 'review.kindWord' : 'review.kindQuote')}
        </span>
        <WeightScale level={level} locale={locale} />
      </div>

      <p
        data-testid="drift-text"
        className="text-[28px] leading-relaxed text-ink"
        lang="zh-Hans"
      >
        {entry.text}
      </p>
      <p className="mt-1 text-sm text-muted">{entry.pinyin ?? toPinyin(entry.text)}</p>

      {entry.kind === 'word' ? (
        <div className="mt-4 flex flex-col gap-3">
          <SpeakButton text={entry.text} locale={locale} />
          {/* initiallyRevealed: Drift never hides anything. */}
          <ReviewInsightReveal
            word={entry}
            locale={locale}
            initiallyRevealed
            dictionaryCacheKey={dictionaryCacheKey}
            dictionarySettings={dictionarySettings}
          />
        </div>
      ) : (
        <QuoteBody quote={entry} />
      )}
    </article>
  );
}

function QuoteBody({ quote }: { quote: QuoteEntry }) {
  const translation = quote.translations?.ai?.text ?? quote.translations?.google?.text;
  return (
    <div className="mt-4 space-y-3">
      {translation && <p className="text-sm text-ink-secondary">{translation}</p>}
      {quote.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {quote.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-chip px-2.5 py-0.5 text-xs text-muted">
              {tag}
            </span>
          ))}
        </div>
      )}
      {quote.sourceUrl && (
        <a
          href={quote.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-muted underline decoration-dotted"
        >
          {quote.sourceTitle || quote.sourceDomain}
        </a>
      )}
    </div>
  );
}

const LEVELS: DriftLevel[] = [MIN_DRIFT_LEVEL, -1, 0, 1, MAX_DRIFT_LEVEL];

function WeightScale({ level, locale }: { level: DriftLevel; locale: UiLocale }) {
  return (
    <span
      className="inline-flex items-center gap-1"
      title={t(locale, 'drift.weightLabel')}
      aria-label={formatMessage(locale, 'drift.weightDot', {
        n: LEVELS.indexOf(level) + 1,
      })}
    >
      {LEVELS.map((step) => (
        <span
          key={step}
          data-testid="drift-dot"
          className={`h-1.5 w-1.5 rounded-full ${
            step === level ? 'bg-accent-deep' : 'bg-border'
          }`}
        />
      ))}
    </span>
  );
}
