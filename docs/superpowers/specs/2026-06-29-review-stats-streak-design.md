# Review Stats & Streak (v0.2.2) — Design

## Summary

Add a **Stats** tab to the dashboard whose primary job is **motivation/habit**:
keep the learner coming back daily. The hero is a **review streak** with a
one-grace-day "freeze" rule, supported by a **today** call-to-action, a
**12-week activity heatmap**, and a **7-day due forecast**. All numbers derive
from data the dashboard already loads (the inbox's per-card `reviewLog` history
and `dueAt` schedule) via a new pure module — no new storage, no sync changes,
and no new permissions.

## Goals

- A dedicated **Stats** tab in the dashboard, alongside Review / Words / Quotes.
- **Current streak** as the hero metric, plus **longest streak** as a personal best.
- A **today** line that turns the streak into a call-to-action ("review to keep
  your N-day streak").
- A **GitHub-style activity heatmap** of the last 12 weeks (reviews per local day).
- A **7-day due forecast** so the learner can see the load ahead.
- A small lifetime **total reviews** stat.
- Full **en / zh-CN** i18n parity for every new string.

## Non-goals

- No insight/analytics surface for v0.2.2: no rating breakdown (again/hard/good/
  easy), no card-maturity pie, no per-tag/per-deck stats. (`retention` already
  exists in the SRS panel and is left as-is.)
- No popup streak indicator (possible later; the Stats tab is the home for now).
- No streak-freeze *token economy* (earn/spend/limit). The freeze is a fixed
  rule, not an item (see "Streak rule").
- No new storage key, no precompute/cache, no sync changes, no migration.
- No charting library.

## Current behavior (baseline)

- The dashboard ([entrypoints/dashboard/App.tsx](../../../entrypoints/dashboard/App.tsx))
  has tabs `'review' | 'words' | 'quotes'` and renders an `SrsStatsPanel` above
  them, backed by `getSrsStats(inbox, now, settings, dueNowCount)`
  ([lib/srs.ts](../../../lib/srs.ts)). That panel already shows **dueNow,
  dueLaterToday, newAvailableToday, reviewedToday, retention**.
- Each **word** carries `review?: ReviewState` and each **cloze**
  (`quote.clozes[].review`) carries its own `ReviewState`. A `ReviewState` holds
  `dueAt` and an uncapped `reviewLog: ReviewLogEntry[]`, where each entry has
  `reviewedAt` (epoch ms) and `rating`. `appendLog` ([lib/srs.ts](../../../lib/srs.ts))
  never truncates, so history is retained in full.
- `srs.ts` already has local-day helpers (`startOfDay` — currently un-exported,
  `startOfNextDay`, `endOfDay`). These define the local-midnight day boundary the
  rest of the app uses; the new module reuses them rather than re-deriving the rule.

The genuinely new surface is therefore **streak, longest streak, heatmap, and a
multi-day forecast** — none of which `getSrsStats` provides. The Stats tab
composes the existing `SrsStats` (for today's due/reviewed numbers) with the new
historical metrics; it does not recompute "due" logic.

## Design

### A. The stats module — `lib/review-stats.ts` (new, pure)

A single deterministic module: given the inbox and a clock, return the habit
metrics. No I/O, no React, no storage, no sync. The only imports are types and
the shared local-day helper.

```ts
export interface DayCount {
  /** Local calendar day, 'YYYY-MM-DD'. */
  date: string;
  count: number;
}

export type StreakState = 'safe' | 'at-risk' | 'broken';

export interface ReviewStats {
  /** Lifetime count of reviewLog entries across all words + clozes. */
  totalReviews: number;
  /** Active days in the current run (freeze rule applied). 0 when none/broken. */
  currentStreak: number;
  /** Longest historical run (freeze rule applied). */
  longestStreak: number;
  streakState: StreakState;
  /** Reviews logged today (local). Equals heatmap's final cell by construction. */
  reviewedToday: number;
  /** Last 84 days (12 weeks), oldest→newest, zero-filled, ending today. */
  heatmap: DayCount[];
  /** Next 7 days incl. today, due-card counts; overdue cards fold into today. */
  forecast: DayCount[];
}

export function computeReviewStats(inbox: Inbox, now?: number): ReviewStats;
```

Internal helpers (each independently testable):

- `collectReviewStates(inbox): ReviewState[]` — flattens `word.review` (when
  present) and every `quote.clozes[].review`. The rest of the module never
  re-walks the inbox shape. Archived entries are **included** (a review you did
  on a card you later archived still happened — it counts toward the habit).
- `reviewDayCounts(states, now): Map<string, number>` — buckets every
  `reviewLog[].reviewedAt` by local day (`'YYYY-MM-DD'`). The single place the
  local-midnight rule is applied.
- `computeStreak(dayCounts, today): { current, longest, state }` — the freeze
  rule (below).
- `buildHeatmap(dayCounts, today, 84): DayCount[]` — zero-filled, oldest→newest,
  ending on `today`.
- `buildForecast(states, today, 7): DayCount[]` — buckets each card's
  `review.dueAt` into the next 7 local days; any `dueAt` ≤ end-of-today folds
  into the **today** bucket. New (never-reviewed, no `dueAt`) cards are ignored
  here — they are not "scheduled."

A local-day helper (`startOfDay`/`localDayKey`) is shared with `srs.ts`. To
avoid two implementations of the midnight boundary, export the existing
`startOfDay` from `lib/srs.ts` (or lift it to a small shared util) and reuse it.
This is the one targeted change to existing code the feature requires.

### B. Streak rule (the freeze)

Definitions, over **local calendar days**:

- A day is **active** if it has ≥1 review (its `reviewDayCounts` value > 0).
- `today = localDayKey(now)`.

**Current streak & state** are determined by the most recent active day:

- Let `lastActive` = the most recent active day ≤ today (null if no reviews ever).
- `gap = whole local days between today and lastActive` (0 if active today).
  - `gap == 0` → reviewed today → **safe**.
  - `gap == 1` → active yesterday, not yet today → **safe** (today is grace; no
    miss has occurred yet).
  - `gap == 2` → yesterday missed, last active was the day before; today not yet
    done → **at-risk** (the freeze is absorbing yesterday; if today ends
    unreviewed, that's two misses in a row and the streak breaks at midnight).
  - `gap >= 3` → two-plus consecutive completed misses already → **broken**,
    `currentStreak = 0`.
  - `lastActive == null` → **broken**, `currentStreak = 0` (UI shows the
    start-a-streak call-to-action; "broken" and "never started" share that CTA).

- **Count:** when not broken, walk backward from `lastActive` counting **active
  days**, tolerating a **single** missed day between active days; stop at the
  first **two consecutive** missed days. The count is the number of active days
  in that run (missed/frozen days are not +1).

**Longest streak:** the same single-gap-tolerant run logic applied across all
history; the longest run (by active-day count) wins.

**Accepted caveat:** because the only break condition is "two consecutive
misses," a strict every-other-day pattern (review, skip, review, skip…) keeps a
streak alive indefinitely. This is accepted for v0.2.2 rather than adding a
freeze-token budget. (Recorded as a known property, not a bug.)

### C. Stats tab UI

Add `'stats'` to the dashboard `Tab` union and a fourth tab button. Tab label
shows no count (unlike words/quotes); it reads simply "Stats" / "统计".

When `tab === 'stats'`, render a new `<ReviewStatsTab stats={reviewStats}
srsStats={srsStats} locale={locale} />` in place of the list. `reviewStats` is
computed with `useMemo(() => computeReviewStats(inbox, reviewNow), [inbox,
reviewNow])`, reusing the same `reviewNow` already established for the SRS
snapshot so the whole dashboard shares one clock per render.

Layout (top → bottom), all hand-rolled with divs/SVG + existing Tailwind theme
tokens (`paper-light`, `paper-input`, `cinnabar`, `border`, etc.):

1. **Streak hero** — large `currentStreak` number with a 🔥 glyph and the unit
   ("day streak"). Beneath it, the state line:
   - safe + reviewed today: "Reviewed today — streak safe."
   - safe + not yet today: "Review today to keep your N-day streak."
   - at-risk: "Freeze used — review today or you'll lose your N-day streak."
   - broken / none: "Start a new streak today."
   A smaller "Best: M days" (longest) sits alongside.
2. **Today** — reuse `srsStats`: "X reviewed · Y due now · Z due later today"
   (from `reviewedToday`, `dueNow`, `dueLaterToday`). No recomputation.
3. **Activity heatmap** — 12 columns × 7 rows of day cells (GitHub-style),
   oldest→newest, shaded in 4–5 buckets by review count (0 = empty paper tone,
   ramping to cinnabar). Each cell has a `title`/`aria-label` of
   "`date`: N reviews". Today's cell is the heatmap's last entry and its count
   equals `srsStats.reviewedToday` by construction.
4. **7-day forecast** — 7 flex bars (today … +6 days), height ∝ due count, each
   labeled with the weekday and count. A "0 due" week renders flat bars with a
   quiet "Nothing scheduled" caption.
5. **Total reviews** — a small footnote stat ("1,234 reviews all-time").

### D. i18n

Add a `stats.*` namespace to **both** locale tables in
[lib/i18n.ts](../../../lib/i18n.ts) (en + zh-CN must stay at full key parity —
`tests/i18n-source.test.ts` enforces this), plus a `tab.stats` label. Proposed
keys (final copy decided in the plan):

- `tab.stats` — "Stats" / "统计"
- `stats.streakUnit` — "day streak" / "天连续"
- `stats.best` — "Best: {n} days" / "最佳：{n} 天"
- `stats.safeReviewed` — "Reviewed today — streak safe." / …
- `stats.safeReviewToday` — "Review today to keep your {n}-day streak." / …
- `stats.atRisk` — "Freeze used — review today or lose your {n}-day streak." / …
- `stats.broken` — "Start a new streak today." / …
- `stats.today` — "{reviewed} reviewed · {dueNow} due now · {dueLater} due later" / …
- `stats.activity` — "Activity (12 weeks)" / …
- `stats.forecast` — "Coming due (7 days)" / …
- `stats.nothingScheduled` — "Nothing scheduled" / …
- `stats.totalReviews` — "{n} reviews all-time" / …

All strings go through `t(locale, key)`; no inline `locale === 'en' ? …` in
`entrypoints/`.

## Data flow

```
inbox (already loaded by useInbox)
  │
  ├─ getSrsStats(...)            → SrsStats (existing: today's due/reviewed/retention)
  │
  └─ computeReviewStats(inbox, now)
        ├─ collectReviewStates   → flatten word.review + clozes[].review
        ├─ reviewDayCounts       → Map<localDay, count>  (from reviewLog[].reviewedAt)
        ├─ computeStreak         → { current, longest, state }
        ├─ buildHeatmap          → DayCount[84]
        └─ buildForecast(states) → DayCount[7]  (from review.dueAt)
                    │
                    ▼
        ReviewStatsTab (reads ReviewStats + SrsStats) → hero / today / heatmap / forecast / total
```

No writes. The tab is read-only; nothing here mutates the inbox, storage, or
sync state.

## Components touched

- `lib/review-stats.ts` (new) — the pure module above.
- `lib/srs.ts` (modify) — export the existing `startOfDay` (or lift a shared
  local-day helper) so the day boundary is defined once.
- `lib/i18n.ts` (modify) — `stats.*` + `tab.stats` keys in both locales.
- `entrypoints/dashboard/App.tsx` (modify) — add `'stats'` to `Tab`, the tab
  button (no count), the `computeReviewStats` memo, and the `tab === 'stats'`
  render branch. `getTabLabel` handles the new tab.
- `entrypoints/dashboard/components/ReviewStatsTab.tsx` (new) — presentational;
  receives `ReviewStats`, `SrsStats`, `locale`; renders hero / today / heatmap /
  forecast / total. Heatmap and forecast may be split into small sub-components
  (`ActivityHeatmap`, `DueForecast`) if `ReviewStatsTab` grows past one screen.

## Testing

- **`tests/review-stats.test.ts`** (the bulk; pure, fast, deterministic via an
  injected `now`):
  - `collectReviewStates` flattens words + clozes and includes archived.
  - `reviewDayCounts` buckets by local day; multiple reviews same day sum.
  - **Streak rule matrix:** reviewed today (safe, counts today); active
    yesterday only (safe, no +1 for today); one-day gap forgiven (freeze, run
    continues); two consecutive misses (broken, resets to 0); at-risk
    (gap == 2, today pending); never-reviewed (0, broken); every-other-day
    (documented: stays alive — asserts the accepted caveat); longest > current.
  - `buildHeatmap` length 84, zero-filled, ends today, today cell ==
    `reviewedToday`.
  - `buildForecast` length 7, overdue folds into today, never-reviewed cards
    excluded.
- **`tests/review-stats-tab.test.tsx`** (happy-dom, mirroring the
  `tests/quote-list.test.tsx` act/DOM pattern): renders each streak state and
  asserts the correct headline; renders the start-CTA when `currentStreak == 0`;
  renders 84 heatmap cells and 7 forecast bars.
- **`tests/i18n-source.test.ts`** — must stay green (en/zh-CN parity for the new
  keys).
- **Regression:** `npm run compile && npm test` green; existing `SrsStatsPanel`
  and dashboard tab tests unaffected.

## Risks / considerations

- **Cross-device history completeness.** `computeReviewStats` reads whatever
  `reviewLog` the materialized inbox contains. Due dates sync across profiles;
  how completely review *history* is reconstructed across devices depends on the
  sync layer's review-event handling (`reviewEvents` in the word node;
  `reviewLog` is stripped from the raw snapshot in
  [lib/sync/project.ts](../../../lib/sync/project.ts) and rebuilt on materialize).
  The module stays decoupled — it treats the inbox as the single source of truth.
  **To verify during planning:** confirm whether a freshly-synced profile
  reconstructs per-day review history (heatmap/streak) or only the latest state.
  If history is local-only, the streak is correctly "this device's" habit and we
  document that; we do **not** change the sync layer in v0.2.2.
- **Pre-feature history.** Because `reviewLog` was already retained uncapped,
  existing users get a populated heatmap/streak immediately — no empty-state
  cold start for anyone who has reviewed before.
- **Performance.** Worst case is a single linear pass over all log entries plus
  an 84-entry and 7-entry build, memoized on `inbox`. Negligible.
- **Timezone/DST.** Local-day bucketing uses the same `Date`-based
  `startOfDay`/`localDayKey` as the rest of the app, so behavior matches the
  existing SRS day boundary, including DST shifts. No separate timezone handling.
- **Empty state.** No reviews ever → streak 0 / broken / start-CTA, an
  all-zero heatmap, a flat "Nothing scheduled" forecast, and "0 reviews
  all-time." All tiles still render.

## Self-Review Notes

- **Goal coverage:** Stats tab (C), current+longest streak hero (A/B/C), today
  CTA (C, reusing SrsStats), 12-week heatmap (A/C), 7-day forecast (A/C), total
  reviews (A/C), i18n parity (D).
- **No duplication:** today's due/reviewed numbers come from the existing
  `getSrsStats`; the new module owns only what's genuinely new (streak, heatmap,
  forecast, lifetime total). The one existing-code change is exporting a shared
  local-day helper.
- **Decisions locked:** motivation/habit framing; Stats tab placement; all four
  tiles; one-grace-day freeze with the every-other-day caveat accepted;
  Approach A (pure derive-on-read) with hand-rolled rendering.
