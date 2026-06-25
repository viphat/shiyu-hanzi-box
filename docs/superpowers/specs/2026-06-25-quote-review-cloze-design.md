# Quote Review: Cloze Deletion Mode — Design Spec

**Status:** Proposed
**Date:** 2026-06-25
**Scope:** Replace the current "show quote, no answer side" review with a single,
well-formed review method for quotes: **cloze deletion**. Words are unchanged.
**Related:** `lib/srs.ts`, `lib/review.ts`, `lib/capture.ts`, `lib/types.ts`,
`lib/normalize.ts`, `lib/markdown.ts`, `lib/backup.ts`, `entrypoints/dashboard/`

---

## 1. Problem

Quotes currently have no answer side. The Review tab shows the full quote and
note immediately, so a quote is recognition-only and the FSRS rating is
meaningless — there is nothing to recall. Cloze deletion gives a quote a real
front (text with a blanked span) and back (the revealed span), turning it into
an active-production item that exercises real language inside the authentic
sentence the user captured.

This spec covers **only** cloze deletion. There is no comprehension mode and no
pronunciation mode for quotes. A quote with no cloze span is not review-eligible.

## 2. Goals / Non-goals

**Goals**

- A quote becomes reviewable iff it has at least one cloze span.
- Cloze spans can be created automatically from already-saved words, and
  added/edited/removed manually.
- Each cloze is a first-class FSRS card with independent scheduling.
- Cloze state survives backup/restore and is represented in Markdown export.
- Traditional toggle never corrupts a blank.

**Non-goals**

- No change to word capture, word dedupe, or word review.
- No automatic CJK word segmentation of arbitrary text (error-prone; out of scope).
- No multi-blank-per-card "fill all blanks at once" UI. One cloze = one card.
- No new network access.
- No Markdown *importer*. `lib/markdown.ts` is export-only; the authoritative
  round-trip path is the JSON backup (§7.1). Markdown cloze syntax exists purely
  for portability into downstream tooling (Anki/PKM).

## 3. Data model

> **Codebase reality check (read before Phase 1).** FSRS state is **not** held in
> an external keyed store today. `ReviewState` is stored *inline on each entry* as
> `EntryBase.review` (`lib/types.ts`). The queue (`buildSrsQueue`), stats
> (`getSrsStats`), and the `answerReview` / `previewReview` / `postponeReview`
> functions (all generic `<T extends Entry>`) read and write `entry.review`
> directly (`lib/srs.ts`). This spec therefore models per-cloze scheduling as
> **inline state per cloze**, matching the existing grain — not as a relocated
> key/value card registry. See §3.3.

### 3.1 Cloze

Offsets are character indices into the **Simplified** `Quote.text` (the canonical
stored form). `end` is exclusive.

> **Convention (confirmed):** `Quote.text` is Simplified. The app is Simplified-source
> throughout — `traditionalText` is a derived S→T cache and `lib/traditional.ts`
> converts one direction only (`cn → twp`). Caveat: this is a *convention*, not a
> runtime-enforced invariant — capture stores the selection verbatim (`text:
> text.trim()` in `lib/capture.ts`) with no S-conversion, so a capture from a
> Traditional source would store Traditional text. Offsets index the stored string
> as-is; the §8 Traditional-toggle rule (suppress the blank, never remap offsets)
> is what keeps that safe regardless.

```ts
// lib/types.ts
export interface Cloze {
  id: string;          // id.ts (makeId) generated, stable for the life of the span
  start: number;       // inclusive char index into Quote.text
  end: number;         // exclusive
  hint?: 'none' | 'pinyin' | 'length'; // what to show on the blank; default 'none'
  wordId?: string;     // set when this span was accepted from a saved word (§4.1, §12.3)
  review?: ReviewState; // per-cloze FSRS state (see §3.3). Absent => never reviewed (new).
}
```

### 3.2 Quote

```ts
export interface QuoteEntry extends EntryBase {
  // ...existing: kind, id, text, note, status, createdAt, updatedAt,
  // pinyin?, traditionalText?, category, tags, source metadata
  clozes?: Cloze[];    // absent or [] => not review-eligible (parked)
  // NOTE: EntryBase.review still exists for words. For quotes it is no longer
  // used for scheduling (see §7.2 migration) — scheduling lives per-cloze.
}
```

Invariants enforced at write time:

- Spans are within `[0, text.length]` and `start < end`.
- Spans do not overlap. Reject overlapping spans at edit time.
- A blanked span should be a meaningful unit (a word/phrase), but the spec does
  not try to validate this beyond non-emptiness — the user owns the choice.

### 3.3 SRS card identity (inline per-cloze state)

Each cloze carries its own `ReviewState` (`Cloze.review`), independent of its
siblings and of the quote. Word cards are **unchanged** — they keep their inline
`WordEntry.review`. There is no relocation of word state and no new keyed store.

For interleaving, dedup, and queue bookkeeping we use a derived, **non-persisted**
card identity string:

```ts
// lib/srs.ts
export type CardSource =
  | { kind: 'word'; entryId: string }
  | { kind: 'cloze'; quoteId: string; clozeId: string };

export type CardId = string; // serialized: `word:<entryId>` | `cloze:<quoteId>:<clozeId>`

export function cardId(source: CardSource): CardId;
```

`CardId` is computed on demand from the entry/cloze; it is **not** a storage key.
This means:

- The existing inline-state machinery (`migrateReviewState`, `toFsrsCard`,
  `fromFsrsResult`, `answerReview`, `previewReview`, `postponeReview`) is reused
  almost verbatim — it already operates on a single `ReviewState`. The new work is
  pointing it at `cloze.review` instead of `entry.review` for cloze cards.
- `answerReview` / `previewReview` / `postponeReview` gain a cloze-aware path.
  Recommended shape: thin wrappers that take a `(quote, clozeId, rating, now,
  settings)` tuple, run the same FSRS step on `cloze.review`, and return an updated
  `QuoteEntry` with that one cloze's `review` replaced. The generic word path is
  untouched.

> Rationale for per-cloze cards: each blank is an independent memory item. You may
> know one word in a sentence and not another. Modeling it correctly is worth the
> per-cloze state, and inline state keeps backup/restore and the queue close to
> their current shape.

## 4. Cloze creation

### 4.1 Auto-candidates from saved words

When a quote is saved, and on demand in the editor, scan `text` for occurrences
of any **saved word** whose `normalized` form matches a normalized substring of
the quote. Surface those ranges as **suggested** clozes the user can accept with
one click. This wires the two halves of the app into one loop: a word saved from
a sentence becomes the blank tested in that sentence.

```ts
// lib/cloze.ts (new)
export function suggestClozes(text: string, savedWords: WordEntry[]): Cloze[];
```

Matching rules:

- Normalize both sides with the existing `normalizeText` (`lib/normalize.ts`) so
  matching is consistent with word dedupe.
- Prefer the longest non-overlapping matches (greedy, left to right).
- Suggestions are **not** auto-committed; the user accepts them. Exception:
  see §4.3 for the save-time convenience path.
- A suggestion accepted from word `w` sets `Cloze.wordId = w.id` (§12.3).

> **Offset back-projection — the hard part, do not hand-wave.** `normalizeText`
> is **not** length-preserving: it strips *all* whitespace, lowercases, folds
> fullwidth→halfwidth, and strips leading/trailing punctuation. A match found in
> *normalized* space therefore does **not** map linearly back to character offsets
> in the raw `Quote.text` that §3.1 requires.
>
> `suggestClozes` must build an index map from each normalized character position
> back to its originating raw `text` index while normalizing (i.e. normalize with
> a parallel `number[]` of source offsets, skipping dropped characters). A match at
> normalized `[i, j)` then resolves to raw `[map[i], map[j-1] + 1)`. Add unit tests
> that exercise quotes containing internal whitespace, fullwidth digits/letters,
> and edge punctuation so the projection is provably correct. This is the most
> error-prone code in the feature.

### 4.2 Manual span selection

In the quote editor (and a quick affordance on the quote card), the user can
drag-select a span of the quote text to mark it as a cloze. Accepted suggestions
and manual spans are stored identically. Editing supports remove and
hint-change per span. Manual spans have no `wordId`.

### 4.3 Save-time behavior

`saveQuote` (in `lib/capture.ts`) gains an option:

```ts
saveQuote(text, src, { autoCloze?: boolean }) // default true
```

When `autoCloze` is true and at least one saved word matches, the top
non-overlapping suggestions are committed as clozes so the quote is immediately
reviewable. If nothing matches, the quote is saved with `clozes: []` and is
**parked** (see §5).

> Implementation note: `saveQuote` currently takes `(text, src)`. The saved-words
> list it needs to match against lives in the same `Inbox` it already mutates via
> `mutateInbox`, so suggestions can be computed inside the mutation callback
> without a new data dependency.

## 5. Review eligibility & queue

- A quote contributes one due card **per cloze** to the review queue.
- A quote with `clozes` absent or empty contributes **no** cards. This is a
  behavior change: `buildSrsQueue` today pushes one item per quote from
  `entry.review`; it must instead expand each quote into its cloze cards and
  **skip quotes with no clozes entirely**.
- Parked quotes (no clozes) are surfaced in the dashboard with a clear
  "Add a blank to review" affordance and a filter/count, so they are never
  silently lost. This is the single most important UX guard of the cloze-only
  decision.
- New-cards-per-day, target retention, and max-interval settings apply to cloze
  cards exactly as they do to word cards. Each cloze counts as one new card the
  first time it appears. (New-card counting reads `reviewLog` entries with
  `stateBefore === 'new'`; per-cloze each cloze owns its own `reviewLog`, so the
  existing counting logic works once it iterates cloze cards.)

`lib/srs.ts` (queue/stats) and `lib/review.ts` (queue wrapper) iterate over
cloze cards (and word cards), expanding quotes into their clozes. The
`SrsQueueItem` shape grows a way to identify *which* cloze a quote item refers to
(e.g. carry `clozeId?: string` alongside `entry`, or carry the derived `CardId`).

## 6. Review UI (Review tab + reveal)

Front (prompt):

- Render the quote with the **active cloze span** replaced by a blank token.
  Other spans render as normal text (they are separate cards, not blanked here).
- Blank rendering honors `hint`:
  - `none` → fixed-width `____`. **Default.**
  - `length` → one box per hidden character (reveals character count).
  - `pinyin` → show the pinyin of the hidden span above the blank.
- Show the quote's `note` only if it does not contain the answer; otherwise hide
  it until reveal. (Heuristic: if the answer substring appears in the note, hide
  the note on the front.)

Reveal (`Reveal / 查看答案`, reusing the word reveal panel where possible):

- Restore the full quote with the answer span highlighted.
- Show pinyin of the answer span and a TTS speaker button (reuse existing TTS
  path). TTS reads the **full quote** (context aids pronunciation memory — §12.1).
- Show the full `note`.

Rating: standard FSRS `Again / Hard / Good / Easy`, plus `Postpone`. Rating
updates the **active cloze's** `review` only (via the cloze-aware wrapper in
§3.3). After rating, the next due card (word or cloze, interleaved by the
existing queue) slides in.

## 7. Migration, backup, export

### 7.1 Backup version bump (`lib/backup.ts`)

- Increment `BACKUP_FORMAT_VERSION` (1 → 2).
- **Required code change, not free:** `readInboxPayload` today enforces *strict
  equality* (`value.formatVersion !== BACKUP_FORMAT_VERSION` throws). Bumping the
  constant would cause every existing v1 backup to be **rejected** outright. Change
  the check to accept any `version <= BACKUP_FORMAT_VERSION` and branch on it, so
  older backups still import.
- Restore of older (v1) backups: quotes load with no `clozes`, so they are parked
  and excluded from review until the user adds a blank. Nothing breaks, nothing is
  dropped.
- Add an `isCloze` validation guard and extend `isQuoteEntry` to validate
  `clozes` on import: well-formed offsets (`0 <= start < end <= text.length`), no
  overlaps, ids present, optional `review` validated by the existing
  `isReviewState`. Invalid cloze arrays are dropped to `[]` for that entry (parking
  it) rather than failing the whole import — matching existing per-entry
  import-validation behavior.
- `cloneInbox` already deep-clones quotes via `cloneJson`, so `clozes` round-trip
  through backup automatically; no change needed there.

### 7.2 SRS state migration (`lib/srs.ts`)

- Word state is **unchanged** — it already lives inline on `WordEntry.review`.
  There is **no** "migrate word state to `word:<id>` keys" step; the earlier
  framing assumed a keyed store that does not exist (§3.3). Words simply continue
  to work.
- Existing per-entry **quote** recognition state (`QuoteEntry.review`) is
  discarded — those cards were not meaningful, and quotes are scheduled today only
  because the queue includes them. New cloze cards start fresh as new cards.
  Document this in the migration note so users understand quote scheduling resets
  once. (Leaving stale `QuoteEntry.review` in place is harmless since the queue no
  longer reads it for quotes; explicitly clearing it on load is optional cleanup.)

### 7.3 Markdown export (`lib/markdown.ts`)

- Export-only; render clozes explicitly so the answer side is legible in the
  output. Use Anki-style cloze syntax for portability:

  ```
  - [ ] > 他{{c1::义无反顾}}地走了。
  ```

  Number `c1, c2, ...` in document order (by `start`). The existing quote line
  prefix `- [ ] > ` is preserved; only the quote body is rewritten to inject
  `{{cN::...}}` at each span. A quote with no clozes exports as plain text
  (current behavior).
- **No round-trip guarantee.** There is no Markdown importer. The test asserts the
  rendered output is *deterministic and correctly numbered*, not that it parses
  back into clozes. JSON backup (§7.1) is the round-trip path.

## 8. Traditional conversion interaction

Cloze offsets index the stored `text` (§3.1). `cn → twp` conversion can change
string length, so offsets do not map onto `traditionalText`.

Rule for v1: **when a card-bearing quote is toggled to Traditional, disable the
blank and show the stored cloze instead** (or simply suppress the 繁 toggle in
review). Do not attempt offset remapping in v1 — a misaligned blank is worse than
no toggle. Offset remapping via an OpenCC alignment pass is a possible future
enhancement, explicitly out of scope here.

## 9. Edge cases

- **Overlapping spans:** rejected at edit time.
- **Span covers whole quote:** allowed but warn; it degenerates to "recall the
  whole sentence."
- **Quote text edited after clozes exist:** if an edit changes length, recompute
  or invalidate affected spans. Simplest safe behavior: on any text edit, clear
  clozes and re-run suggestions, prompting the user to re-confirm. Prevents silent
  offset drift. **Warn before discarding**, since clearing clozes discards their
  FSRS history.
- **Duplicate identical quotes:** quotes are not deduped (existing behavior); each
  carries its own clozes independently.
- **Word later deleted:** auto-suggested clozes are copies; deleting the source
  word does not remove the cloze. `Cloze.wordId` may then dangle — treat a missing
  word as "no link" gracefully.

## 10. Test plan (Vitest)

New / updated tests:

- `cloze.test.ts` — `suggestClozes`: longest-match, non-overlap, normalization
  parity with word dedupe, **offset back-projection** across whitespace /
  fullwidth / edge-punctuation quotes, `wordId` set on suggestions, no-match
  returns `[]`.
- `capture.test.ts` — `saveQuote` with `autoCloze` true/false; parked quote when
  no match; cloze invariants enforced.
- `srs.test.ts` — per-cloze inline state; one quote with N clozes yields N cards;
  rating one cloze does not affect siblings; new-card cap counts clozes; quote with
  no clozes yields **zero** cards; word inline state untouched; old quote
  recognition state discarded.
- `markdown.test.ts` — `{{cN::...}}` rendering in document order under the
  `- [ ] > ` prefix; plain text when no clozes; deterministic output (no
  round-trip-parse claim).
- `backup.test.ts` — version bump to 2; **v1 backup still imports** and parks
  quotes; invalid cloze arrays dropped to `[]` per policy; valid clozes round-trip.
- Review UI test — front blanks only the active span; reveal restores and
  highlights; hint modes render (`none` default); Traditional toggle
  suppressed/disabled in review.

## 11. Implementation checklist (phased)

**Phase 1 — model + capture**
- [ ] Add `Cloze` (with `wordId?` and `review?`) and `Quote.clozes` to `lib/types.ts`.
- [ ] `lib/cloze.ts` with `suggestClozes` + offset-back-projection + tests.
- [ ] `saveQuote` `autoCloze` option + invariants + tests.

**Phase 2 — scheduling**
- [ ] `CardId` / `CardSource` derivation helpers in `lib/srs.ts` (non-persisted id).
- [ ] Cloze-aware `answerReview` / `previewReview` / `postponeReview` wrappers
      operating on `cloze.review`.
- [ ] `buildSrsQueue` / `getSrsStats` expand quotes into cloze cards; quotes with
      no clozes contribute nothing. Discard old quote recognition state.
- [ ] `lib/review.ts` wrapper + `SrsQueueItem` carries the cloze identity; tests.

**Phase 3 — review UI**
- [ ] Front blanking with hint modes (`none` default); reveal panel reuse; rating
      wiring to the active cloze.
- [ ] Traditional toggle suppressed in review.

**Phase 4 — editor + parked quotes**
- [ ] Drag-select + suggestion-accept cloze editor on the quote card.
- [ ] Parked-quote filter/count + "Add a blank to review" affordance.

**Phase 5 — export/backup**
- [ ] Markdown `{{cN::...}}` rendering under existing quote prefix.
- [ ] Backup version bump + backward-compatible version check + restore migration
      + `isCloze` import validation.

## 12. Resolved decisions (formerly open questions)

1. **TTS on reveal:** reads the **full quote**, not just the answer span —
   context aids pronunciation memory. Reuses the existing TTS path.
2. **Default `hint`:** `none`. Revisit `length` if users find bare `____` too hard
   for multi-character spans.
3. **Link cloze back to source word:** **yes — store `Cloze.wordId`** when a
   suggestion that matches a saved word is accepted (Phase 1). One optional field,
   it enables future "review this word in all its sentences" features, and
   retrofitting later would require re-matching. A dangling `wordId` (word deleted)
   is treated as "no link" (§9).
