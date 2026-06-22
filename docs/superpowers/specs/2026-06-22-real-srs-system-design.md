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
buildSrsQueue(inbox, now)
answerReview(entry, rating, now)
previewReview(entry, now)
migrateReviewState(entry)
```

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
  scheduler: ReviewScheduler;
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
  retrievability?: number;
  reviewLog?: ReviewLogEntry[];
}
```

Compatibility rule:

- Existing entries without `scheduler` are treated as `fixed-v1`.
- Existing entries without `review` are treated as new FSRS cards due at
  `createdAt`.
- Once a user answers a migrated card, persist it as `fsrs-v1`.

## Migration Strategy

Use lazy migration, not a one-time storage migration.

When the queue is built or an item is reviewed:

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
```

Recommended first UI:

- Desired retention slider or select: `0.80` to `0.97`, default `0.90`.
- Maximum interval input/select: default `3650` days.
- New items per day input/select: default `20`.

Avoid exposing FSRS parameters directly in the first version. They are powerful
but too fiddly for this extension's audience.

## Review Flow

Change review cards from "mark viewed" to active recall:

1. Show the prompt first.
   - For words: show Hanzi and source label.
   - For quotes: show quote text and category/source label.
2. Hide answer details initially.
   - For words: pinyin, local definitions, source examples, AI insight.
   - For quotes: note/source details if present.
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

## Scheduling Rules

Use full timestamps, not only start-of-day dates.

Why: a real scheduler has learning and relearning steps that can be minutes
apart. The current `endOfDay(now)` behavior makes all items due later today
appear immediately, which is wrong for sub-day learning steps.

Queue rules:

- Main queue includes items with `dueAt <= now`.
- "Due today" stat can count items with `dueAt <= endOfDay(now)`.
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
- Retention estimate, when enough review logs exist

Do not add charts in the first pass. Keep stats textual and useful.

## File-Level Plan

Expected creates:

- `lib/srs.ts`
- `tests/srs.test.ts`

Expected modifications:

- `package.json` and lockfile: add `ts-fsrs`.
- `lib/types.ts`: extend review types.
- `lib/review.ts`: either replace internals with SRS helpers or become a
  compatibility re-export layer.
- `lib/backup.ts`: validate new persisted review fields.
- `lib/markdown.ts`: optional concise review metadata.
- `entrypoints/dashboard/App.tsx` or `entrypoints/newtab/App.tsx`: use the new
  queue and rating handlers, depending on whether the optional dashboard spec has
  landed first.
- `entrypoints/*/components/ReviewQueue.tsx`: reveal-then-rate flow.
- `lib/settings.ts`, `entrypoints/settings/SettingsApp.tsx`, and `lib/i18n.ts`:
  SRS settings UI and localized labels.
- `README.md`: describe real SRS and rating meanings.

## Testing Strategy

Use TDD for scheduler behavior.

Focused tests:

- `tests/srs.test.ts`
  - Initializes new entries as FSRS new cards.
  - Migrates old fixed-ladder review state without losing due dates.
  - Schedules different intervals for Again, Hard, Good, and Easy.
  - Preserves deterministic results with fuzz disabled.
  - Builds due-now queues using `dueAt <= now`, not end-of-day.
  - Appends review logs only for actual ratings.
  - Postpone changes due date without changing memory state.
- `tests/review.test.ts`
  - Either update to the new SRS API or reduce to compatibility coverage.
- `tests/backup.test.ts`
  - Accepts valid `fsrs-v1` review state and rejects malformed values.
- Component/source tests
  - Review UI has Reveal and Again/Hard/Good/Easy controls.
  - Existing local insight reveal still works after answer reveal.

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

No automatic bulk migration is needed. Old items migrate when displayed or
reviewed.

## Acceptance Criteria

1. Review cards use Reveal followed by Again/Hard/Good/Easy ratings.
2. Ratings produce different schedules for the same item.
3. The scheduler persists card state, stability, difficulty, due date, interval,
   and review log locally.
4. Existing entries without new SRS fields still appear in the review queue.
5. Existing fixed-ladder review states migrate without losing due dates.
6. Queue membership uses `dueAt <= now`.
7. SRS settings exist with desired retention defaulting to `0.90`.
8. Backup/restore preserves SRS state.
9. `npm run compile`, `npm test`, and `npm run build` pass.
10. No network access is required for SRS.

## References

- FSRS project: https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler
- TypeScript scheduler docs: https://open-spaced-repetition.github.io/ts-fsrs/
- Python FSRS API docs: https://open-spaced-repetition.github.io/py-fsrs/fsrs.html
