// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReviewStatsTab } from '../entrypoints/dashboard/components/ReviewStatsTab';
import { messages } from '../lib/i18n';
import type { ReviewStats } from '../lib/review-stats';
import type { SrsStats } from '../lib/srs';

function makeStats(overrides: Partial<ReviewStats> = {}): ReviewStats {
  return {
    totalReviews: 1234,
    currentStreak: 5,
    longestStreak: 9,
    streakState: 'safe',
    reviewedToday: 3,
    driftedToday: 0,
    totalDrifted: 0,
    heatmap: Array.from({ length: 84 }, (_, i) => ({
      date: `d${i}`,
      count: i % 4,
    })),
    forecast: Array.from({ length: 7 }, (_, i) => ({ date: `2026-07-0${i + 1}`, count: i })),
    ...overrides,
  };
}

function makeSrs(overrides: Partial<SrsStats> = {}): SrsStats {
  return { dueNow: 2, dueLaterToday: 4, newAvailableToday: 1, reviewedToday: 3, retention: null, ...overrides };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

describe('ReviewStatsTab', () => {
  it('renders 84 heatmap cells and 7 forecast bars', async () => {
    await render(<ReviewStatsTab stats={makeStats()} srsStats={makeSrs()} locale="en" />);
    expect(container.querySelectorAll('[data-testid="heat-cell"]')).toHaveLength(84);
    expect(container.querySelectorAll('[data-testid="forecast-bar"]')).toHaveLength(7);
  });

  it('safe + reviewed today: shows the "streak safe" headline', async () => {
    await render(<ReviewStatsTab stats={makeStats({ streakState: 'safe', reviewedToday: 3 })} srsStats={makeSrs()} locale="en" />);
    expect(container.textContent).toContain('Reviewed today — streak safe.');
  });

  it('safe + not yet today: shows the "review today to keep" headline', async () => {
    await render(<ReviewStatsTab stats={makeStats({ streakState: 'safe', reviewedToday: 0, currentStreak: 5 })} srsStats={makeSrs({ reviewedToday: 0 })} locale="en" />);
    expect(container.textContent).toContain('Review today to keep your 5-day streak.');
  });

  it('at-risk: shows the freeze-used headline', async () => {
    await render(<ReviewStatsTab stats={makeStats({ streakState: 'at-risk', reviewedToday: 0, currentStreak: 5 })} srsStats={makeSrs({ reviewedToday: 0 })} locale="en" />);
    expect(container.textContent).toContain('Freeze used — review today or lose your 5-day streak.');
  });

  it('broken / zero streak: shows the start-a-streak CTA', async () => {
    await render(<ReviewStatsTab stats={makeStats({ streakState: 'broken', currentStreak: 0, reviewedToday: 0 })} srsStats={makeSrs({ reviewedToday: 0 })} locale="en" />);
    expect(container.textContent).toContain('Start a new streak today.');
  });

  it('renders "Nothing scheduled" when the whole forecast is zero', async () => {
    const flat = makeStats({ forecast: Array.from({ length: 7 }, (_, i) => ({ date: `2026-07-0${i + 1}`, count: 0 })) });
    await render(<ReviewStatsTab stats={flat} srsStats={makeSrs()} locale="en" />);
    expect(container.textContent).toContain('Nothing scheduled');
  });
});

describe('drift in the stats tab', () => {
  it('outlines a drift-only day in the heatmap', async () => {
    await render(
      <ReviewStatsTab
        stats={makeStats({ heatmap: [{ date: '2026-08-11', count: 0, driftCount: 4 }] })}
        srsStats={makeSrs()}
        locale="en"
      />,
    );
    expect(container.querySelector('[data-testid="heat-cell"]')!.className).toContain('border');
  });

  it('titles a drift day with both figures', async () => {
    await render(
      <ReviewStatsTab
        stats={makeStats({ heatmap: [{ date: '2026-08-11', count: 2, driftCount: 4 }] })}
        srsStats={makeSrs()}
        locale="en"
      />,
    );
    const title = container.querySelector('[data-testid="heat-cell"]')!.getAttribute('title');
    expect(title).toContain('4');
    expect(title).toContain('2');
  });

  it('leaves a review-only day on the plain tooltip', async () => {
    await render(
      <ReviewStatsTab
        stats={makeStats({ heatmap: [{ date: '2026-08-11', count: 2, driftCount: 0 }] })}
        srsStats={makeSrs()}
        locale="en"
      />,
    );
    expect(container.querySelector('[data-testid="heat-cell"]')!.getAttribute('title'))
      .toBe('2026-08-11: 2 reviews');
  });

  it('shows the lifetime drift figure', async () => {
    await render(
      <ReviewStatsTab stats={makeStats({ totalDrifted: 42 })} srsStats={makeSrs()} locale="en" />,
    );
    expect(container.textContent).toContain('42');
  });

  it('hides the drift legend when nothing has been drifted', async () => {
    await render(
      <ReviewStatsTab stats={makeStats({ totalDrifted: 0 })} srsStats={makeSrs()} locale="en" />,
    );
    expect(container.textContent).not.toContain(messages.en['stats.legendDrift']);
  });

  it('treats a drift-only day as keeping the streak safe', async () => {
    await render(
      <ReviewStatsTab
        stats={makeStats({ streakState: 'safe', currentStreak: 3, reviewedToday: 0, driftedToday: 5 })}
        srsStats={makeSrs({ reviewedToday: 0 })}
        locale="en"
      />,
    );
    expect(container.textContent).toContain(messages.en['stats.safeReviewed']);
  });

  it('shows the drifted-today count in the Today section when greater than zero', async () => {
    await render(
      <ReviewStatsTab stats={makeStats({ driftedToday: 7 })} srsStats={makeSrs()} locale="en" />,
    );
    expect(container.textContent).toContain('7 drifted today');
  });

  it('leaves the pre-Drift Today section unchanged when nothing was drifted today', async () => {
    await render(
      <ReviewStatsTab stats={makeStats({ driftedToday: 0 })} srsStats={makeSrs()} locale="en" />,
    );
    expect(container.textContent).not.toContain('drifted today');
  });

  it('leaves the lifetime totalReviews figure unchanged when totalDrifted is set', async () => {
    await render(
      <ReviewStatsTab
        stats={makeStats({ totalReviews: 1234, totalDrifted: 42 })}
        srsStats={makeSrs()}
        locale="en"
      />,
    );
    expect(container.textContent).toContain('1,234 reviews all-time');
  });
});
