# Drift Review Mode (漫读) — Design

**Date:** 2026-08-11
**Target release:** 0.5.0
**Status:** Approved

## Summary

Add a second review mode, **Drift / 漫读**, selectable from the Settings page as
an alternative to the existing FSRS spaced-repetition mode. Drift shows saved
words and quotes one at a time in weighted random order, with everything
visible — no blanks, no reveal, no grading. Two thumbs adjust how often an entry
resurfaces. It is browsing, not testing.

Drift exists because the SRS queue only ever surfaces what is due, and only what
has been prepared for it. Parked quotes (no cloze blanks) are invisible to SRS
entirely. Drift gives the whole collection a way to come back into view, and
gives the user a low-effort way to show up on a day they cannot face a queue.

## Goals

- A no-pressure browsing mode over the full collection, chosen in Settings.
- Thumbs that shape what resurfaces, bounded and always reversible.
- FSRS state left completely untouched by Drift.
- Drift activity keeps the review streak alive without inflating review counts.

## Non-goals

- Recall testing, grading, or any scheduling in Drift.
- Cross-device sync of Drift weights (see "Deferred").
- Keyboard shortcuts (`ReviewQueue` has none today; adding them to one mode
  only would be inconsistent).
- Any change to FSRS, the cloze editor, or capture.

## Decisions

| Question | Decision |
| --- | --- |
| Signal | A separate per-entry weight. FSRS state is never written by Drift. |
| Mode switch | Settings radio; the Review tab renders whichever mode is selected. |
| Weight rules | Bounded nudge, never permanent. Nothing is ever hidden or removed. |
| Card content | Everything visible at once. No hide/reveal. |
| Navigation | One card; thumb-up, thumb-down, or Skip advances. Endless. Back undoes. |
| Stats | Drift days keep the streak and heatmap alive; lifetime reviews stay SRS-only. |

## Architecture

### Where Drift state lives

Drift state lives in its own `chrome.storage.local` item, **outside the inbox**.

This is a correctness requirement, not a preference. `lib/sync/coordinator.ts`
computes `materialize(merged)` and calls `setInbox(out.inbox)`, and
`lib/storage.ts` `setInbox` is a blind `setValue` — a full replace. Any entry
field that `materialize` does not emit is destroyed on every sync pass. Storing
Drift weights on the entry would make them evaporate for every sync user.

(The same mechanism was destroying quote `clozes`, which `materialize` did not
emit either — a v0.4.x data-loss bug found while writing this design and fixed
separately in `9218ffa`..`837b831` by projecting clozes into `SyncState`. The
fix removes that particular casualty but not the rule: `setInbox` is still a
blind replace, so an unprojected field is still deleted. Drift's design does not
depend on that work either way.)

The rejected alternatives, for the record:

- **On the entry, projected into `SyncState`.** Gets cross-device weights, but
  needs new registers, merge rules, and `materialize` wiring in the most
  delicate module in the codebase — and last-writer-wins on a counter silently
  drops concurrent increments from two devices. Deferred, not refused;
  projecting a flat map later is a far easier migration than un-projecting
  entry fields.
- **On the entry, local-only.** Fewest lines, silently deleted on every sync
  pass. Rejected.

### Key space

Drift weights are keyed on the word's `normalized` text, **not** entry `id`,
with each kind namespaced:

- Words: `word:${normalized}`.
- Quotes: `quote:${id}`.

Word `id` is not stable. `pickWordId` in `lib/sync/project.ts` picks a canonical
id when two replicas merge the same word, so a word's `id` can change under the
user. Keying weights by `id` would silently orphan them on merge. `normalized`
survives.

Both kinds carry a prefix so the two key spaces cannot overlap. Without one, a
word whose normalized text happened to be the literal string `quote:q1` would
share a key with quote `q1` — vanishingly unlikely, but free to rule out.

### Data model

New module `lib/drift.ts`, pure and free of I/O:

```ts
/** weight = 2 ** level  →  0.25× … 4×. Absent key ⇒ 0 (neutral). */
export type DriftLevel = -2 | -1 | 0 | 1 | 2;

export interface DriftStore {
  weights: Record<string, DriftLevel>;
  /** 'YYYY-MM-DD' (local day) → cards drifted that day. */
  days: Record<string, number>;
}

export const EMPTY_DRIFT_STORE: DriftStore = { weights: {}, days: {} };
```

Bounded at ±2, one notch per tap, clamped at both ends. A thumbed-down word is
rare, never impossible — it can resurface when the user is ready for it, and a
thumb-up walks it straight back. Keys absent from the inbox are ignored on read,
so orphaned weights need no garbage collection.

`lib/drift.ts` also exports a pure `normalizeDriftStore` that clamps levels and
drops malformed entries read back from disk or restored from a backup file. It
lives in the pure module rather than the storage one so `lib/backup.ts` can
sanitize an untrusted `drift` blob without gaining a storage dependency.

Storage wrapper in `lib/drift-storage.ts` (`local:drift`), following the shape
of `lib/settings.ts`: `getDriftStore`, `mutateDriftStore`, `replaceDriftStore`,
and `watchDriftStore`, each normalizing on the way in and out.

### Pool and picker

The pool is every non-archived word plus every non-archived quote — including
**parked quotes with no clozes**, which SRS can never show.

```ts
export function driftKey(entry: Entry): string;
export function buildDriftPool(inbox: Inbox): Entry[];
export function pickDriftCard(
  pool: Entry[],
  store: DriftStore,
  recent: string[],
  random: () => number,
): Entry | null;
```

`pickDriftCard` excludes any key in `recent`, then draws by weighted cumulative
sum over `2 ** level`. `random` is injected so the distribution is testable.
`recent` is a ring of the last `min(20, floor(pool.length / 2))` keys, held in
component state — session-scoped, not persisted. The `floor(pool/2)` bound
guarantees the ring can never exclude the entire pool. Returns `null` only when
the pool is empty.

## UX

The Review tab renders `DriftView` when `settings.reviewMode === 'drift'`, and
the existing `ReviewQueue` otherwise. Tab labels, the empty state, and the
Toolbar are unchanged apart from the review-count badge, which shows the pool
size in Drift mode.

New file `entrypoints/dashboard/components/DriftView.tsx` holds `DriftView`
(pool, picker wiring, recent ring, history for Back) and the presentational
`DriftCard` it renders — the same split `ReviewQueue.tsx` uses today. One card
at a time, reusing the existing `REVIEW_TRANSITION_MS` fade so the two modes
feel like the same app.

**Word card.** Text at display size, tone chips, speaker button, pinyin,
CC-CEDICT and CVDICT definitions, the AI insight if one has already been
generated, and source examples. Composed from the existing `WordInsightPanel`,
`ToneChips`, and `SpeakButton` rather than reimplemented. Drift never triggers
AI generation on its own — it only displays what is already saved.

**Quote card.** The full sentence rendered plainly, with **no cloze blanks**,
plus pinyin, the translation if present, tags, and the source link.

**Controls.** A bottom pill row: 👎 · Skip · 👍. Thumbs record a level change
and advance; Skip advances without recording. A quiet Back returns to the
previous card and undoes its level change if one was recorded — so a mistap
costs nothing. A five-dot scale shows the card's current level, so the thumbs
visibly do something.

**Session.** Endless. There is no done screen and no session target; the user
leaves whenever they like.

**Empty state.** When the pool is empty, the same "nothing here yet" treatment
the Review tab uses today, with copy pointing at capture rather than at cloze
editing.

## Stats

`computeReviewStats` already takes `now` as its second parameter, so `driftDays`
is appended third:

```ts
computeReviewStats(
  inbox: Inbox,
  now = Date.now(),
  driftDays: Record<string, number> = {},
): ReviewStats
```

Defaulted, so every existing caller and test compiles unchanged. The union of
`reviewDayCounts(...)` and `driftDays` is built before `computeStreak` is
called, so `computeStreak` and `buildHeatmap` keep their current signatures.

- **Streak** — active days become the union of review days and drift days. The
  existing one-grace-day freeze rule (`continuesRun`) is untouched and applies
  to the union. Showing up to drift keeps a streak alive.
- **Heatmap** — `DayCount` gains `driftCount`. A day with reviews renders as it
  does today; a drift-only day renders in a distinct, quieter tone. The legend
  gains a line for it.
- **`totalReviews`** — unchanged, SRS only. A separate lifetime "cards drifted"
  figure sits beside it, clearly labelled.
- **`reviewedToday`** — unchanged. A `driftedToday` field is added alongside.
- **Forecast** — untouched.

While the user is in Drift mode the SRS queue keeps accruing `dueAt` normally.
Switching back is non-destructive and shows a real backlog; nothing is
rescheduled or forgiven behind the user's back.

## Settings

`AppSettings` gains:

```ts
export type ReviewMode = 'srs' | 'drift';
// AppSettings.reviewMode: ReviewMode
```

Default `'srs'`, so existing users see no change until they opt in.
`normalizeSettings` falls back to `'srs'` for any unrecognized stored value.

Presented as a two-option radio in the Settings page under a "Review mode"
heading, each with a one-line description. The SRS knobs (retention, new cards
per day, fuzz) stay visible in both modes, since they still govern the SRS queue
accruing in the background.

`reviewMode` is deliberately **not** added to `materialize`'s
`portableSettings`. It stays per-device, matching the recent decision to keep
CVDICT settings local — a laptop and a desktop can reasonably want different
modes.

## Backup

The full backup gains `drift: DriftStore` and carries `reviewMode` inside its
existing settings blob. `FULL_BACKUP_FORMAT_VERSION` goes from 3 to 4.

`lib/backup.ts` currently detects a full backup with a strict
`value.formatVersion === FULL_BACKUP_FORMAT_VERSION`. Bumping the constant alone
would push every existing v3 file into the inbox-only fallback branch, silently
dropping the user's settings and AI key on restore. The check must therefore
accept **3 or 4**, with v3 restores defaulting `drift` to `EMPTY_DRIFT_STORE`
and `reviewMode` to `'srs'`.

The inbox-only backup (format version 2) is unchanged — Drift state is not
inbox data.

## i18n

New keys in both `en` and `zh-CN`, following the existing `review.*` naming:
`drift.title`, `drift.seeMore`, `drift.seeLess`, `drift.skip`, `drift.back`,
`drift.empty`, `drift.weightLabel`, `settings.reviewMode`, `settings.modeSrs`,
`settings.modeSrsHint`, `settings.modeDrift`, `settings.modeDriftHint`,
`stats.driftedToday`, `stats.totalDrifted`, `stats.legendDrift`.

## Testing

`lib/drift.ts` is pure and RNG-injected, which is most of the value here.

- Level clamping at both bounds; thumb-up then thumb-down returns to neutral.
- Weighted draw hits expected proportions under a seeded RNG.
- The recent ring never repeats a key inside its window, and never excludes the
  whole pool (single-entry and two-entry pools).
- Pool excludes archived entries and **includes** parked quotes.
- Orphaned weight keys are ignored rather than throwing.
- `normalizeDriftStore` clamps out-of-range and malformed persisted levels.
- Day-log increments on thumb and on skip; Back decrements.
- `review-stats` streak over the union of review and drift days, including the
  grace-day rule spanning a review day and a drift day.
- Backup round-trip at v4, **and** a v3 fixture restoring with settings and AI
  key intact.

## Deferred

- Syncing Drift weights across devices (needs a proper CRDT for the counter).
- Keyboard shortcuts for both review modes, together.
- Any Drift-specific analytics beyond the two figures described above.
