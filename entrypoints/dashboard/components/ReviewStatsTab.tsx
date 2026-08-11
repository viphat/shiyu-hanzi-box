import { Flame } from 'lucide-react';
import { formatMessage, t } from '@/lib/i18n';
import type { DayCount, ReviewStats } from '@/lib/review-stats';
import type { SrsStats } from '@/lib/srs';
import type { UiLocale } from '@/lib/types';

const HEATMAP_ROWS = 7;

function heatClass(count: number): string {
  if (count <= 0) return 'bg-paper-input';
  if (count < 3) return 'bg-accent-tint';
  if (count < 6) return 'bg-accent-wash';
  if (count < 10) return 'bg-accent';
  return 'bg-accent-deep';
}

function streakLine(stats: ReviewStats, locale: UiLocale): string {
  if (stats.streakState === 'broken' || stats.currentStreak === 0) {
    return t(locale, 'stats.broken');
  }
  if (stats.streakState === 'at-risk') {
    return formatMessage(locale, 'stats.atRisk', { n: stats.currentStreak });
  }
  // safe
  if (stats.reviewedToday > 0 || stats.driftedToday > 0) return t(locale, 'stats.safeReviewed');
  return formatMessage(locale, 'stats.safeReviewToday', { n: stats.currentStreak });
}

function weekdayLabel(dateKey: string, locale: UiLocale): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(y, m - 1, d));
}

export function ReviewStatsTab({
  stats,
  srsStats,
  locale,
}: {
  stats: ReviewStats;
  srsStats: SrsStats;
  locale: UiLocale;
}) {
  const maxForecast = Math.max(1, ...stats.forecast.map((c) => c.count));
  const forecastEmpty = stats.forecast.every((c) => c.count === 0);

  return (
    <div className="space-y-5">
      {/* Streak hero */}
      <section className="rounded-2xl border border-border bg-card-soft p-5 text-center shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
        <div className="flex items-center justify-center gap-2">
          <Flame className="h-8 w-8 text-accent-deep" aria-hidden="true" />
          <span className="text-5xl font-bold leading-none text-accent-strong">
            {stats.currentStreak}
          </span>
        </div>
        <div className="mt-1 text-sm tracking-[1px] text-muted">
          {t(locale, 'stats.streakUnit')}
        </div>
        <p className="mt-3 text-sm text-ink-secondary">{streakLine(stats, locale)}</p>
        <p className="mt-1 text-xs text-muted">
          {formatMessage(locale, 'stats.best', { n: stats.longestStreak })}
        </p>
      </section>

      {/* Today */}
      <section className="rounded-2xl border border-border-soft bg-paper-light px-4 py-3 text-sm text-ink-secondary">
        {formatMessage(locale, 'stats.today', {
          reviewed: srsStats.reviewedToday,
          dueNow: srsStats.dueNow,
          dueLater: srsStats.dueLaterToday,
        })}
      </section>

      {/* Activity heatmap */}
      <section className="rounded-2xl border border-border bg-card-soft p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
        <h3 className="mb-3 text-xs font-medium tracking-[1px] text-muted">
          {t(locale, 'stats.activity')}
        </h3>
        <div
          className="grid grid-flow-col gap-1"
          style={{ gridTemplateRows: `repeat(${HEATMAP_ROWS}, minmax(0, 1fr))` }}
        >
          {stats.heatmap.map((cell: DayCount) => {
            const drifted = cell.driftCount ?? 0;
            const label = drifted > 0
              ? formatMessage(locale, 'stats.heatmapCellDrift', {
                  date: cell.date,
                  n: cell.count,
                  d: drifted,
                })
              : formatMessage(locale, 'stats.heatmapCell', { date: cell.date, n: cell.count });
            return (
              <div
                key={cell.date}
                data-testid="heat-cell"
                title={label}
                aria-label={label}
                // A drift-only day is outlined rather than filled: it kept the
                // streak alive, but it was not retrieval practice.
                className={`h-3 w-3 rounded-[3px] ${heatClass(cell.count)} ${
                  drifted > 0 && cell.count === 0 ? 'border border-accent-fade' : ''
                }`}
              />
            );
          })}
        </div>
        {stats.totalDrifted > 0 && (
          <p className="mt-2 text-[11px] text-muted">{t(locale, 'stats.legendDrift')}</p>
        )}
      </section>

      {/* 7-day forecast */}
      <section className="rounded-2xl border border-border bg-card-soft p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
        <h3 className="mb-3 text-xs font-medium tracking-[1px] text-muted">
          {t(locale, 'stats.forecast')}
        </h3>
        <div className="flex items-end justify-between gap-2" style={{ height: '96px' }}>
          {stats.forecast.map((cell: DayCount) => (
            <div key={cell.date} data-testid="forecast-bar" className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[11px] text-ink-secondary">{cell.count}</span>
              <div
                className="w-full rounded-t bg-accent"
                style={{ height: `${Math.round((cell.count / maxForecast) * 64) + 2}px` }}
              />
              <span className="text-[10px] text-muted">{weekdayLabel(cell.date, locale)}</span>
            </div>
          ))}
        </div>
        {forecastEmpty && (
          <p className="mt-2 text-center text-xs text-muted">{t(locale, 'stats.nothingScheduled')}</p>
        )}
      </section>

      {/* Lifetime totals — reviews and drift stay separate on purpose. */}
      <p className="text-center text-xs text-muted">
        {formatMessage(locale, 'stats.totalReviews', { n: stats.totalReviews.toLocaleString(locale) })}
        {stats.totalDrifted > 0 && (
          <>
            {' · '}
            {formatMessage(locale, 'stats.totalDrifted', {
              n: stats.totalDrifted.toLocaleString(locale),
            })}
          </>
        )}
      </p>
    </div>
  );
}
