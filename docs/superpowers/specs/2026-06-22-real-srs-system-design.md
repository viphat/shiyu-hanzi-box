# Real SRS System Design

## Goal

Upgrade the current review queue into a real spaced repetition system that
schedules each saved word or quote from user recall quality, item difficulty,
memory stability, and target retention.

The first implementation should stay local-first, deterministic in tests, and
simple enough to ship without turning the extension into a full flashcard app.

## Current State

`lib/review.ts` currently implements a fixed interval ladder:

```ts
const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60];
```

The dashboard exposes three actions:

- **Viewed:** increments `repetitions` and moves to the next fixed interval.
- **Tomorrow:** postpones one day without counting as a review.
- **Later:** keeps the item due today and moves it to the back of the queue.

This is useful, but not enough to call the feature real SRS. Every remembered
item advances through the same ladder regardless of how hard it was, how many
times it was forgotten, how late the review was, or how stable the memory is.

## Non-Goals

- Do not change capture, dedupe, dictionary lookup, AI insight, Markdown export,
  backup format goals, or optional dashboard access behavior.
- Do not require network access.
- Do not require Anki, AnkiConnect, or any external account.
- Do not implement optimizer training in the first pass.
- Do not add push notifications or Chrome alarms in the first pass.

## Approaches Considered

### Option A: Improve The Existing Fixed Ladder

Add more buttons and tweak interval arrays. This is small, but it still cannot
model memory. It would remain a review queue with better ergonomics, not real
SRS.

### Option B: Implement SM-2

SM-2 is well-known and easy to implement: store ease factor, interval, and
repetition count. It would be a real SRS step up, but it is older and less
adaptive than modern FSRS schedulers.

### Option C: Use FSRS Through `ts-fsrs` (Recommended)

Use the open-spaced-repetition TypeScript scheduler package as the scheduling
engine and wrap it in a small project-local adapter. FSRS models memory through
difficulty, stability, and retrievability, and uses four review ratings:

- Again
- Hard
- Good
- Easy

This gives the extension a real scheduler without inventing our own math.

## Recommended Architecture

Add a pure SRS domain module around `ts-fsrs`:

```text
lib/srs.ts
```

Responsibilities:

- Convert a persisted `ReviewState` into an FSRS card.
- Convert an FSRS result back into the persisted `ReviewState`.
- Map UI ratings to scheduler ratings.
- Build due queues from `Inbox`.
- Migrate old fixed-ladder review state lazily.
- Expose deterministic helpers for tests.

UI components should not import `ts-fsrs` directly. They should call project
helpers such as:

```ts
buildSrsQueue(inbox, now, settings)
answerReview(entry, rating, now, settings)
previewReview(entry, now, settings)
postponeReview(entry, now, dueAt)
migrateReviewState(entry)
```

The SRS module should also expose a small scheduler factory, for example
`createSrsScheduler(settings)`, so `desiredRetention`, `maximumIntervalDays`,
and `enableFuzz` are the single source of truth for the `ts-fsrs` scheduler
parameters. Tests should pass settings with fuzz disabled rather than reaching
into `ts-fsrs` directly.

## Data Model

Extend `ReviewState` in `lib/types.ts` instead of creating a separate persisted
card table. The data remains attached to each `WordEntry` and `QuoteEntry`,
which keeps backup/export restore behavior straightforward.

Recommended shape:

```ts
export type ReviewScheduler = 'fixed-v1' | 'fsrs-v1';
export type ReviewCardState = 'new' | 'learning' | 'review' | 'relearning';
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewLogEntry {
  reviewedAt: number;
  rating: ReviewRating;
  elapsedDays: number;
  scheduledDays: number;
  stateBefore: ReviewCardState;
  stateAfter: ReviewCardState;
  stabilityBefore?: number;
  stabilityAfter?: number;
  difficultyBefore?: number;
  difficultyAfter?: number;
}

export interface ReviewState {
  scheduler?: ReviewScheduler;
  dueAt: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt?: number;
  queueRank?: number;

  cardState?: ReviewCardState;
  stability?: number;
  difficulty?: number;
  elapsedDays?: number;
  scheduledDays?: number;
  learningSteps?: number;
  retrievability?: number;
  reviewLog?: ReviewLogEntry[];
}
```

Compatibility rule:

- Existing entries without `scheduler` are treated as `fixed-v1`.
- Existing entries without `review` are treated as new FSRS cards due at
  `createdAt`.
- Once a user answers or postpones a migrated card, persist it as `fsrs-v1`.

## Migration Strategy

Use lazy migration, not a one-time storage migration.

When the queue is built, an item is reviewed, or an item is postponed:

1. If `entry.review?.scheduler === 'fsrs-v1'`, use it directly.
2. If `entry.review` is missing, initialize an FSRS new card with
   `cardState: 'new'`, `dueAt: entry.createdAt`, and zero counts.
3. If an old fixed-ladder review exists, preserve its due date and approximate
   an FSRS review card:
   - `cardState: 'review'` when `repetitions > 0`, otherwise `new`.
   - `stability: max(1, intervalDays || 1)`.
   - `difficulty: clamp(5 + lapses * 0.5, 1, 10)`.
   - `dueAt`, `repetitions`, `lapses`, and `lastReviewedAt` copied forward.

This keeps existing user progress usable while accepting that old fixed-ladder
data cannot perfectly reconstruct memory state.

## Settings

Add SRS settings to the existing Settings page, stored in `local:settings`:

```ts
export interface SrsSettings {
  desiredRetention: number; // default 0.9
  maximumIntervalDays: number; // default 3650
  newCardsPerDay: number; // default 20
  enableFuzz: boolean; // default true in production, false in tests
}

export interface AppSettings {
  uiLocale: UiLocale;
  kaikki: KaikkiSettings;
  srs: SrsSettings;
}
```

Recommended first UI:

- Desired retention slider or select: `0.80` to `0.97`, default `0.90`.
- Maximum interval input/select: default `3650` days.
- New items per day input/select: default `20`.

Avoid exposing FSRS parameters directly in the first version. They are powerful
but too fiddly for this extension's audience.

Existing installs already have `local:settings` without an `srs` key. Add a
settings normalization helper that deep-merges stored settings with
`DEFAULT_SETTINGS` before dashboard reads, settings-page reads, watches, and
mutations use the value. The storage fallback only handles missing storage; it
does not fill newly-added nested settings on existing installs.

## Review Flow

Change review cards from "mark viewed" to active recall:

1. Show the prompt first.
   - For words: show Hanzi and source label.
   - For quotes: show category/source label first, then ask the user to recall
     the quote text; the quote text itself belongs in the answer area after
     reveal.
2. Hide answer details initially.
   - For words: pinyin, local definitions, source examples, AI insight.
   - For quotes: quote text, note, and source details if present.
3. User clicks **Reveal**.
4. User chooses one of four rating buttons:
   - **Again:** forgot or could not recall.
   - **Hard:** recalled with serious effort.
   - **Good:** recalled correctly.
   - **Easy:** recalled immediately.
5. The scheduler updates the item and removes it from the current queue unless
   it remains due now as a learning/relearning step.

The current "Tomorrow" action should become a secondary **Postpone** action.
Postpone should not create a review log entry and should not alter stability or
difficulty.

Postpone still needs to persist a new `dueAt`. If the card has no review state,
persist it as an `fsrs-v1` `new` card with zero counts and no
stability/difficulty. If the card has an old fixed-ladder review state, lazily
migrate it first, then change only `dueAt`, `scheduledDays`, `updatedAt`, and
queue positioning fields. This prevents postponed migrated cards from remaining
in the old scheduler indefinitely.

## Scheduling Rules

Use full timestamps, not only start-of-day dates.

Why: a real scheduler has learning and relearning steps that can be minutes
apart. The current `endOfDay(now)` behavior makes all items due later today
appear immediately, which is wrong for sub-day learning steps.

Queue rules:

- Main queue includes items with `dueAt <= now`.
- The dashboard schedules a local timer for the next future `dueAt` and local
  midnight so sub-day cards appear without a storage mutation or manual reload.
- "Due today" stat can count items with `dueAt <= endOfDay(now)`.
- New-card limiting applies only to cards whose migrated state is `new`.
  Learning, relearning, and long-term review cards are never hidden by the
  daily new-card limit.
- `newCardsPerDay` is enforced at queue-build time by counting review log
  entries from the current local day where `stateBefore === 'new'`, then showing
  at most the remaining number of due new cards. New cards hidden by the cap
  are not mutated; they become eligible after the next local day begins or after
  the user raises the setting.
- "New available today" is the smaller of remaining new-card capacity and due
  new cards currently hidden or visible by the cap.
- Learning/relearning cards due now sort before long-term review cards.
- Repeated same-session cards sort behind untouched due cards unless FSRS
  returns a due timestamp that is already due.

## Backups And Export

Backup parsing must validate the new optional fields:

- `scheduler`
- `cardState`
- `stability`
- `difficulty`
- `elapsedDays`
- `scheduledDays`
- `learningSteps`
- `retrievability`
- `reviewLog`

Markdown export should not dump the full review log. It may include concise
review metadata, for example:

```text
Review: due 2026-06-25, state review, interval 3 days
```

JSON backup remains the complete fidelity format.

## Analytics

Add small dashboard stats, computed locally:

- Due now
- Due later today
- New available today
- Reviewed today
- Retention estimate after at least 10 review logs exist

Do not add charts in the first pass. Keep stats textual and useful.

## File-Level Plan

Expected creates:

- `lib/srs.ts`
- `tests/srs.test.ts`

Expected modifications:

- `package.json` and lockfile: add `ts-fsrs`. The current package requires
  Node `>=20`; document this in `package.json` `engines` or project docs if the
  repo starts enforcing runtime versions.
- `lib/types.ts`: extend review types.
- `lib/review.ts`: either replace internals with SRS helpers or become a
  compatibility re-export layer.
- `lib/backup.ts`: validate new persisted review fields.
- `lib/markdown.ts`: optional concise review metadata.
- `entrypoints/newtab/App.tsx`, plus any dashboard entrypoint that exists when
  this work starts: use the new queue and rating handlers.
- `entrypoints/*/components/ReviewQueue.tsx`: reveal-then-rate flow.
- `lib/settings.ts`, `entrypoints/settings/SettingsApp.tsx`, and `lib/i18n.ts`:
  SRS settings UI and localized labels.
- `entrypoints/newtab/hooks/useSettings.ts` and popup/settings consumers: read
  settings through the normalization helper so old stored settings gain `srs`
  defaults.
- `README.md`: describe real SRS and rating meanings.

## Testing Strategy

Use TDD for scheduler behavior.

Focused tests:

- `tests/srs.test.ts`
  - Initializes new entries as FSRS new cards.
  - Migrates old fixed-ladder review state without losing due dates.
  - Schedules different intervals for Again, Hard, Good, and Easy.
  - Preserves deterministic results with fuzz disabled.
  - Persists and round-trips `learningSteps` so a learning card graduates
    correctly after reload.
  - Passes SRS settings into queue, preview, answer, and scheduler construction.
  - Builds due-now queues using `dueAt <= now`, not end-of-day.
  - Enforces `newCardsPerDay` only for new cards and never for learning,
    relearning, or review cards.
  - Appends review logs only for actual ratings.
  - Postpone changes due date without changing memory state.
- `tests/review.test.ts`
  - Either update to the new SRS API or reduce to compatibility coverage.
- `tests/backup.test.ts`
  - Accepts valid `fsrs-v1` review state and rejects malformed values.
- `tests/settings.test.ts`
  - Normalizes older persisted settings that do not yet contain `srs`.
- Component/source tests
  - Review UI has Reveal and Again/Hard/Good/Easy controls.
  - Existing local insight reveal still works after answer reveal.
  - Quote review prompts hide quote text until reveal.

Full verification:

```bash
npm run compile
npm test
npm run build
```

## Rollout

The safest rollout is additive and lazy:

1. Add the new SRS module and tests.
2. Extend persisted types and backup parser.
3. Update review queue logic.
4. Update review UI to reveal-then-rate.
5. Add settings.
6. Update docs.

No automatic bulk migration is needed. Old items migrate when displayed,
reviewed, or postponed.

## Acceptance Criteria

1. Review cards use Reveal followed by Again/Hard/Good/Easy ratings.
2. Ratings produce different schedules for the same item.
3. The scheduler persists card state, stability, difficulty, learning-step
   progress, due date, interval, and review log locally.
4. Existing entries without new SRS fields still appear in the review queue.
5. Existing fixed-ladder review states migrate without losing due dates.
6. Queue membership uses `dueAt <= now`, and the dashboard wakes when the next
   future sub-day card becomes due.
7. SRS settings exist with desired retention defaulting to `0.90`.
8. Older stored `local:settings` values without `srs` are normalized to include
   default SRS settings.
9. `newCardsPerDay` limits only new cards; due learning, relearning, and review
   cards remain visible.
10. Quote review prompts hide the quote text until Reveal.
11. Backup/restore preserves SRS state.
12. `npm run compile`, `npm test`, and `npm run build` pass.
13. No network access is required for SRS.

## References

- FSRS project: https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler
- TypeScript scheduler docs: https://open-spaced-repetition.github.io/ts-fsrs/
- Python FSRS API docs: https://open-spaced-repetition.github.io/py-fsrs/fsrs.html
