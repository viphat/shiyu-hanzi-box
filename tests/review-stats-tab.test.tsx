// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReviewStatsTab } from '../entrypoints/dashboard/components/ReviewStatsTab';
import type { ReviewStats } from '../lib/review-stats';
import type { SrsStats } from '../lib/srs';

function makeStats(overrides: Partial<ReviewStats> = {}): ReviewStats {
  return {
    totalReviews: 1234,
    currentStreak: 5,
    longestStreak: 9,
    streakState: 'safe',
    reviewedToday: 3,
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
