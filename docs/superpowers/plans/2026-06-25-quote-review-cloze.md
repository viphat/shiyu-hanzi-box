# Quote Review: Cloze Deletion Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source spec:** `docs/superpowers/specs/2026-06-25-quote-review-cloze-design.md`

**Goal:** Replace recognition-only quote review with cloze deletion. A quote becomes
reviewable only when it has at least one cloze span; each cloze is an independent
FSRS card scheduled in the existing queue. Auto-suggest clozes from saved words,
allow manual editing, surface parked (cloze-less) quotes, and round-trip cloze state
through backup and Markdown export. Words are unchanged.

**Architecture:** FSRS state stays **inline** (the codebase has no keyed card store).
Word state remains on `WordEntry.review`; each cloze carries its own
`Cloze.review: ReviewState`. `buildSrsQueue`/`getSrsStats` expand every non-archived
quote into one queue item per cloze (quotes with no clozes contribute nothing).
A derived, non-persisted `CardId` string (`word:<id>` | `cloze:<quoteId>:<clozeId>`)
identifies queue items for interleaving and answer routing. The existing single-state
FSRS engine (`toFsrsCard`/`fromFsrsResult`/scheduler) is reused verbatim; only the
`ReviewState` pointer changes (entry vs. cloze) via cloze-aware wrappers.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, WXT, Vitest, Happy DOM (already a
dev dependency from the single-card review work) for interaction tests.

---

## File Structure

**Creates:**

- `lib/cloze.ts` — `suggestClozes`, normalization-with-offset-map, invariant helpers
  (`normalizeClozes`, `clozesOverlap`).
- `tests/cloze.test.ts` — suggestion, longest-match, non-overlap, offset back-projection.

**Modifies:**

- `lib/types.ts` — add `Cloze`; add `clozes?` and (informational) cloze notes to `QuoteEntry`.
- `lib/capture.ts` — `saveQuote(text, src, opts?)` with `autoCloze` (default true).
- `lib/srs.ts` — `CardSource`/`CardId`/`cardId()`; cloze-aware `answerReview`/
  `previewReview`/`postponeReview`; expand quotes to cloze cards in
  `buildSrsQueue`/`getSrsStats`/`getNextSrsWakeAt`; `SrsQueueItem.clozeId`.
- `lib/review.ts` — keep the wrapper compiling against the new `SrsQueueItem`.
- `lib/markdown.ts` — render `{{cN::...}}` into the quote line in document order.
- `lib/backup.ts` — version bump to 2; backward-compatible version check; `isCloze`
  validation folded into `isQuoteEntry`.
- `lib/i18n.ts` — cloze/parked-quote UI strings (en + zh-CN).
- `entrypoints/dashboard/App.tsx` — thread `clozeId` through answer/postpone; parked-quote count.
- `entrypoints/dashboard/components/ReviewQueue.tsx` — blank the active span, hint
  rendering, reveal highlight, suppress 繁 toggle, route rating to the cloze.
- `entrypoints/dashboard/components/QuoteCard.tsx` — cloze editor (suggest/accept,
  drag-select, remove, hint), "Add a blank to review" affordance.
- `entrypoints/dashboard/components/QuoteList.tsx` — parked filter/count surface.
- `tests/srs.test.ts`, `tests/capture.test.ts`, `tests/markdown.test.ts`,
  `tests/backup.test.ts`, `tests/review-queue.test.tsx`, `tests/i18n.test.ts` — coverage.
- `README.md`, `AGENTS.md` — document cloze review and the per-cloze card model.

---

# Phase 1 — Model + Capture

## Task 1: Add the `Cloze` type and `QuoteEntry.clozes`

**Files:** Modify `lib/types.ts`, `tests/types-srs.test.ts` (or add a small type-level assertion).

- [ ] **Step 1: Add the type.** In `lib/types.ts`, above `QuoteEntry`, add:

```ts
/** A blanked span in a quote. One cloze = one FSRS card. */
export interface Cloze {
  id: string;          // makeId(); stable for the life of the span
  start: number;       // inclusive char index into the Simplified Quote.text
  end: number;         // exclusive
  hint?: 'none' | 'pinyin' | 'length'; // blank presentation; default 'none'
  wordId?: string;     // set when accepted from a saved word
  review?: ReviewState; // per-cloze FSRS state; absent => new
}
```

Add to `QuoteEntry`:

```ts
  clozes?: Cloze[];    // absent or [] => parked (not review-eligible)
```

- [ ] **Step 2: Compile.** `npm run compile` — expected exit 0 (field is optional;
  nothing else breaks yet).
- [ ] **Step 3: Commit.**

```bash
git add lib/types.ts
git commit -m "feat(cloze): add Cloze type and Quote.clozes field"
```

## Task 2: `lib/cloze.ts` — suggestions with correct offset back-projection

The spec's hardest piece: `normalizeText` strips whitespace, lowercases, folds
fullwidth, and trims edge punctuation, so it is **not** length-preserving. Build a
parallel source-offset map during a local normalize pass and project matches back to
raw `text` indices.

**Files:** Create `lib/cloze.ts`, `tests/cloze.test.ts`.

- [ ] **Step 1: Write the failing tests** in `tests/cloze.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { suggestClozes } from '../lib/cloze';
import type { WordEntry } from '../lib/types';

function word(text: string, overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: `w-${text}`, kind: 'word', text, normalized: text, note: '',
    status: 'inbox', createdAt: 0, updatedAt: 0, occurrences: [], ...overrides,
  };
}

describe('suggestClozes', () => {
  it('returns [] when no saved word matches', () => {
    expect(suggestClozes('他走了。', [word('开心')])).toEqual([]);
  });

  it('maps a match back to raw text offsets', () => {
    const text = '他义无反顾地走了。';
    const [c] = suggestClozes(text, [word('义无反顾')]);
    expect(text.slice(c.start, c.end)).toBe('义无反顾');
    expect(c.wordId).toBe('w-义无反顾');
    expect(c.hint).toBe('none');
  });

  it('projects across stripped whitespace and fullwidth chars', () => {
    const text = '他 说 ＡＢＣ 很好';      // spaces + fullwidth ABC
    const [c] = suggestClozes(text, [word('abc', { normalized: 'abc' })]);
    expect(text.slice(c.start, c.end)).toBe('ＡＢＣ');
  });

  it('prefers the longest non-overlapping match, left to right', () => {
    const text = '学而时习之';
    const out = suggestClozes(text, [word('学'), word('学而时习之')]);
    expect(out).toHaveLength(1);
    expect(text.slice(out[0].start, out[0].end)).toBe('学而时习之');
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/cloze.test.ts` — FAIL
  (module missing).
- [ ] **Step 3: Implement `lib/cloze.ts`.** Mirror `normalizeText`'s transforms but
  emit a `number[]` mapping each normalized char index to its source index:

```ts
import { makeId } from './id';
import { normalizeText } from './normalize';
import type { Cloze, WordEntry } from './types';

interface NormalizedView { normalized: string; map: number[]; } // map[i] = raw index

// Re-implement normalize transforms char-by-char, recording source offsets and
// dropping the same characters normalizeText drops (whitespace, edge punctuation).
function normalizeWithMap(text: string): NormalizedView { /* ... */ }

export function suggestClozes(text: string, savedWords: WordEntry[]): Cloze[] {
  const view = normalizeWithMap(text);
  // Collect candidate [start,end) raw ranges for every saved word's normalized form,
  // sort by length desc then position, greedily accept non-overlapping ranges
  // left-to-right, then return sorted by start.
}
```

Implementation notes:
- Reuse `normalizeText(word.normalized)` (or `word.normalized` directly) for the needle
  so matching is dedupe-consistent. Skip empty needles.
- A normalized match at `[i, j)` → raw range `[map[i], map[j - 1] + 1)`.
- Greedy: sort candidates by `(end-start) desc`, accept if it overlaps no accepted range.
- Each accepted range → `{ id: makeId(), start, end, hint: 'none', wordId: word.id }`.
- **Determinism:** assert no `Math.random()`/`Date.now()` reliance in test expectations
  beyond `id` (tests check offsets/wordId, not `id` value).

- [ ] **Step 4: Run to verify pass.** `npx vitest run tests/cloze.test.ts` + `npm run compile`.
- [ ] **Step 5: Commit.**

```bash
git add lib/cloze.ts tests/cloze.test.ts
git commit -m "feat(cloze): suggest clozes from saved words with offset mapping"
```

## Task 3: `saveQuote` gains `autoCloze`

**Files:** Modify `lib/capture.ts`, `tests/capture.test.ts`.

- [ ] **Step 1: Add failing tests** to `tests/capture.test.ts` (a saved word must exist
  first; `saveWord` then `saveQuote`):

```ts
describe('saveQuote autoCloze', () => {
  it('commits matching saved words as clozes by default', async () => {
    await saveWord('义无反顾', src);
    const q = await saveQuote('他义无反顾地走了。', src);
    expect(q?.clozes?.length).toBe(1);
    expect(q!.text.slice(q!.clozes![0].start, q!.clozes![0].end)).toBe('义无反顾');
  });

  it('parks the quote when nothing matches', async () => {
    const q = await saveQuote('他走了。', src);
    expect(q?.clozes).toEqual([]);
  });

  it('does not auto-cloze when autoCloze is false', async () => {
    await saveWord('义无反顾', src);
    const q = await saveQuote('他义无反顾地走了。', src, { autoCloze: false });
    expect(q?.clozes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/capture.test.ts`.
- [ ] **Step 3: Implement.** Change the signature to
  `saveQuote(text, src, opts: { autoCloze?: boolean } = {})` with `autoCloze` defaulting
  to `true`. Compute suggestions **inside** the `mutateInbox` callback (the inbox in
  scope already holds `words`), so no new data dependency:

```ts
const clozes = opts.autoCloze !== false
  ? suggestClozes(trimmed, inbox.words)
  : [];
// ...quote: { ...fields, clozes }
```

Set `clozes: []` (never `undefined`) so parked state is explicit and serializes.
- [ ] **Step 4: Run to verify pass.** `npx vitest run tests/capture.test.ts` + compile.
- [ ] **Step 5: Commit.**

```bash
git add lib/capture.ts tests/capture.test.ts
git commit -m "feat(cloze): auto-suggest clozes when saving a quote"
```

---

# Phase 2 — Scheduling

## Task 4: `CardId` derivation + cloze-aware FSRS wrappers

**Files:** Modify `lib/srs.ts`, `tests/srs.test.ts`.

- [ ] **Step 1: Add failing tests** to `tests/srs.test.ts` (the file already has `word()`
  / `quote()` factories and `NOW`). Add a `quote` with two clozes and assert independence:

```ts
function clozedQuote(): QuoteEntry {
  return quote({
    id: 'q1', text: '他义无反顾地走了',
    clozes: [
      { id: 'cz1', start: 1, end: 5, hint: 'none' }, // 义无反顾
      { id: 'cz2', start: 6, end: 7, hint: 'none' }, // 走
    ],
  });
}

it('rates one cloze without affecting its sibling', () => {
  const q = clozedQuote();
  const next = answerReviewCloze(q, 'cz1', 'good', NOW, NO_FUZZ);
  const c1 = next.clozes!.find((c) => c.id === 'cz1')!;
  const c2 = next.clozes!.find((c) => c.id === 'cz2')!;
  expect(c1.review?.repetitions).toBe(1);
  expect(c2.review).toBeUndefined(); // untouched
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Add the identity helpers and cloze wrappers. The generic
  word path (`answerReview<T extends Entry>`) stays; add cloze-specific functions that
  run the **same** FSRS step on `cloze.review`:

```ts
export type CardSource =
  | { kind: 'word'; entryId: string }
  | { kind: 'cloze'; quoteId: string; clozeId: string };
export type CardId = string;
export function cardId(s: CardSource): CardId {
  return s.kind === 'word' ? `word:${s.entryId}` : `cloze:${s.quoteId}:${s.clozeId}`;
}

export function answerReviewCloze(
  quote: QuoteEntry, clozeId: string, rating: ReviewRating, now: number, settings: SrsSettings,
): QuoteEntry {
  const clozes = (quote.clozes ?? []).map((c) => {
    if (c.id !== clozeId) return c;
    const review = c.review ?? newReviewStateExport(now); // reuse newReviewState
    const scheduler = createSrsScheduler(settings);
    const result = scheduler.next(toFsrsCard(review), now, RATING_TO_GRADE[rating]);
    const log = toReviewLogEntry(review, result.card, rating, now);
    return { ...c, review: { ...fromFsrsResult(result.card, review, now),
      reviewLog: appendLogExport(review, log) } };
  });
  return { ...quote, status: quote.status === 'archived' ? 'archived' : 'reviewed',
    updatedAt: now, clozes };
}
// previewReviewCloze(quote, clozeId, now, settings) and postponeReviewCloze(quote, clozeId, now, dueAt)
// mirror previewReview/postponeReview on cloze.review.
```

`newReviewState` and `appendLog` are currently module-private — either export them or
inline equivalents in the cloze wrappers. Prefer exporting to avoid drift.
- [ ] **Step 4: Run to verify pass** + compile.
- [ ] **Step 5: Commit.**

```bash
git add lib/srs.ts tests/srs.test.ts
git commit -m "feat(cloze): per-cloze FSRS rating with stable card ids"
```

## Task 5: Expand quotes into cloze cards in the queue and stats

**Files:** Modify `lib/srs.ts`, `lib/review.ts`, `tests/srs.test.ts`.

- [ ] **Step 1: Add failing tests:**

```ts
it('expands a quote into one card per cloze', () => {
  const inbox: Inbox = { words: [], quotes: [clozedQuote()] };
  const due = buildSrsQueue(inbox, NOW, NO_FUZZ);
  expect(due.filter((i) => i.kind === 'quote')).toHaveLength(2);
  expect(due.map((i) => i.clozeId).sort()).toEqual(['cz1', 'cz2']);
});

it('contributes no cards for a quote with no clozes', () => {
  const inbox: Inbox = { words: [], quotes: [quote({ clozes: [] })] };
  expect(buildSrsQueue(inbox, NOW, NO_FUZZ)).toHaveLength(0);
});

it('counts each new cloze against the daily new-card cap', () => { /* N clozes => N new */ });
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Add `clozeId?: string` to `SrsQueueItem`. In
  `buildSrsQueue`, replace the per-quote push with per-cloze expansion:
  - Words: unchanged (read `entry.review`).
  - Quotes: for each `cloze` in `entry.clozes ?? []`, derive a working `ReviewState`
    (`cloze.review ?? newReviewState(entry.createdAt)`), apply the **same** `dueAt`/state
    sorting and `cardState === 'new'` cap logic per cloze, and push
    `{ kind: 'quote', entry, clozeId: cloze.id, dueAt }`. A quote with no clozes pushes
    nothing.
  - The sort comparator currently reads `a.entry.review` — change it to read the item's
    effective review (word → `entry.review`, cloze → the cloze's review) via a small
    `itemReview(item)` helper so learning/new ranking still works per card.
  - `getSrsStats` and `getNextSrsWakeAt`: iterate the same expansion (count due-new and
    due-later per cloze; quotes without clozes add nothing). `countNewReviewedToday`
    must scan `cloze.review?.reviewLog` for quotes as well as `entry.review?.reviewLog`
    for words.
- [ ] **Step 4: Confirm `lib/review.ts` compiles** (it re-exports `SrsQueueItem` and
  delegates to `buildSrsQueue`; no logic change, just the wider item type).
- [ ] **Step 5: Run to verify pass** + compile + `npx vitest run tests/review.test.ts`.
- [ ] **Step 6: Commit.**

```bash
git add lib/srs.ts lib/review.ts tests/srs.test.ts
git commit -m "feat(cloze): expand quotes into per-cloze review cards"
```

## Task 6: Drop legacy quote recognition state

**Files:** Modify `lib/srs.ts` (migration note), `tests/srs.test.ts`.

- [ ] **Step 1: Test** that a pre-existing `QuoteEntry.review` does not produce a queue
  card on its own (only clozes do) and that word state is untouched. (Largely covered by
  Task 5's "no clozes => no cards"; add an explicit case where a quote has both a stale
  `review` and `clozes: []` and yields zero cards.)
- [ ] **Step 2: Implement.** No active migration is required because the queue no longer
  reads `quote.review`. Optionally clear it in `migrateReviewState` for quotes to keep
  storage clean; if so, guard on `entry.kind === 'quote'`. Add a code comment documenting
  the one-time scheduling reset.
- [ ] **Step 3: Run + compile + commit.**

```bash
git add lib/srs.ts tests/srs.test.ts
git commit -m "feat(cloze): retire recognition-only quote scheduling"
```

---

# Phase 3 — Review UI

## Task 7: i18n strings for cloze review and parked quotes

**Files:** Modify `lib/i18n.ts`, `tests/i18n.test.ts`.

- [ ] **Step 1: Failing test** in `tests/i18n.test.ts` for new keys in both locales,
  e.g. `cloze.addBlank` ("Add a blank to review" / "添加填空以复习"), `cloze.parked`
  ("Parked — no blank" / "待添加填空"), `cloze.parkedCount` ("{count} parked"),
  `cloze.blankAria` ("hidden answer"), `review.answer` ("Answer" / "答案"),
  `cloze.removeBlank`, `cloze.hintNone`/`cloze.hintPinyin`/`cloze.hintLength`.
- [ ] **Step 2–4: Add keys (en + zh-CN), run, pass.** Note `tests/i18n-source.test.ts`
  enforces locale-key parity — add to **both** blocks.
- [ ] **Step 5: Commit.**

```bash
git add lib/i18n.ts tests/i18n.test.ts
git commit -m "feat(cloze): add cloze and parked-quote UI strings"
```

## Task 8: Render the cloze front, hints, and reveal in `ReviewQueue`

**Files:** Modify `entrypoints/dashboard/components/ReviewQueue.tsx`,
`entrypoints/dashboard/App.tsx`, `tests/review-queue.test.tsx`.

Quote items now carry `clozeId`. The card must blank only the active span and route
the rating to that cloze.

- [ ] **Step 1: Update the handler types and App wiring (failing first).** Widen
  `AnswerHandler`/`PostponeHandler` to accept an optional `clozeId`:
  `(kind, id, rating, clozeId?) => void | Promise<void>`. In `App.tsx`, `answerEntry`
  /`postponeEntry` branch on `clozeId`: when present and `kind === 'quote'`, call
  `answerReviewCloze`/`postponeReviewCloze` inside `updateReviewEntry`'s quote map;
  otherwise keep the word path. Pass `item.clozeId` from `ReviewQueue` to the handlers.
- [ ] **Step 2: Add failing component tests** in `tests/review-queue.test.tsx` (Happy DOM
  harness already present):
  - Front blanks **only** the active span: render a quote item with two clozes,
    `clozeId` = first; assert the first span's text is absent and replaced by the blank
    token, the second span's text is still visible.
  - `hint: 'length'` renders one box per hidden char; `hint: 'none'` renders fixed `____`;
    `hint: 'pinyin'` shows pinyin above the blank.
  - Reveal restores full text with the answer highlighted and shows the note.
  - Note containing the answer substring is hidden on the front, shown on reveal.
- [ ] **Step 3: Implement** the blanking renderer for quote cards: split `entry.text`
  into `before = text.slice(0, c.start)`, `answer = text.slice(c.start, c.end)`,
  `after = text.slice(c.end)`; render `before`, the blank element (per `hint`), `after`.
  On reveal show `answer` highlighted (reuse cinnabar highlight styling) plus the note
  and the existing TTS `SpeakButton` (reads the **full quote** per spec §12.1). Ratings
  call `onAnswer(kind, id, rating, clozeId)`. Keep word rendering untouched.
- [ ] **Step 4: Run** `npx vitest run tests/review-queue.test.tsx` + compile.
- [ ] **Step 5: Commit.**

```bash
git add entrypoints/dashboard/components/ReviewQueue.tsx entrypoints/dashboard/App.tsx tests/review-queue.test.tsx
git commit -m "feat(cloze): blank the active span and reveal the answer in review"
```

## Task 9: Suppress the Traditional toggle in cloze review

**Files:** Modify `entrypoints/dashboard/components/ReviewQueue.tsx`, `tests/review-queue.test.tsx`.

- [ ] **Step 1: Failing test** — a quote review card does not render the `TraditionalButton`
  (繁) affordance (offsets index Simplified; remapping is out of scope per spec §8).
- [ ] **Step 2: Implement** — omit/disable the Traditional toggle on the quote review card.
- [ ] **Step 3: Run + compile + commit.**

```bash
git add entrypoints/dashboard/components/ReviewQueue.tsx tests/review-queue.test.tsx
git commit -m "feat(cloze): suppress traditional toggle during cloze review"
```

---

# Phase 4 — Editor + Parked Quotes

## Task 10: Cloze editor on the quote card

**Files:** Modify `entrypoints/dashboard/components/QuoteCard.tsx`, add a focused test
(`tests/quote-card.test.tsx` or extend an existing quote test).

- [ ] **Step 1: Failing test** covering: suggested clozes appear with an Accept control;
  accepting writes a `Cloze` (with `wordId`) to the quote; removing a cloze deletes it;
  changing a hint persists; overlapping/empty spans are rejected (`normalizeClozes`
  invariant from `lib/cloze.ts`).
- [ ] **Step 2: Implement** in `QuoteCard.tsx`:
  - Show existing clozes as removable chips with a hint selector.
  - "Suggest blanks" runs `suggestClozes(quote.text, inbox.words)` filtered to spans not
    already present; each is one-click acceptable.
  - Drag-select over the rendered quote text yields a `{start, end}` (map DOM selection
    offsets back to string indices); validate via the invariant helper before commit.
  - All edits go through `updateQuote(id, { clozes })`; reject overlaps (§9). On any edit
    to `quote.text` itself, clear clozes and re-suggest with a confirm prompt (§9 — warn
    that FSRS history is discarded).
- [ ] **Step 3: Run + compile + commit.**

```bash
git add entrypoints/dashboard/components/QuoteCard.tsx tests/quote-card.test.tsx
git commit -m "feat(cloze): add cloze editor to the quote card"
```

## Task 11: Parked-quote filter, count, and affordance

**Files:** Modify `entrypoints/dashboard/components/QuoteList.tsx`,
`entrypoints/dashboard/App.tsx`, test.

- [ ] **Step 1: Failing test** — a quote with `clozes` empty/absent is flagged "parked",
  surfaces an "Add a blank to review" action, and is counted in a parked filter/badge.
- [ ] **Step 2: Implement** the parked predicate (`!quote.clozes?.length`), a count badge,
  a filter toggle in `QuoteList`, and the affordance wired to the Task 10 editor. This is
  the spec's primary UX guard (§5) — non-archived parked quotes must never be silent.
- [ ] **Step 3: Run + compile + commit.**

```bash
git add entrypoints/dashboard/components/QuoteList.tsx entrypoints/dashboard/App.tsx tests/quote-list.test.tsx
git commit -m "feat(cloze): surface parked quotes with add-a-blank affordance"
```

---

# Phase 5 — Export + Backup

## Task 12: Markdown `{{cN::...}}` rendering

**Files:** Modify `lib/markdown.ts`, `tests/markdown.test.ts`.

- [ ] **Step 1: Failing test** in `tests/markdown.test.ts`:

```ts
it('renders clozes as numbered {{cN::...}} in document order', () => {
  const md = renderDay('2026-06-25', [], [quote({
    text: '他义无反顾地走了',
    clozes: [{ id: 'b', start: 6, end: 7 }, { id: 'a', start: 1, end: 5 }],
  })]);
  expect(md).toContain('- [ ] > 他{{c1::义无反顾}}地{{c2::走}}了');
});
it('renders a clozeless quote as plain text (unchanged)', () => { /* ... */ });
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** In the quote loop (currently
  `lines.push(\`- [ ] > ${esc(quote.text)}\`)`), if `quote.clozes?.length`, sort clozes by
  `start`, number `c1..cN`, and build the body by splicing `{{cN::answer}}` over each span
  (walk left→right so later offsets stay valid). Escape with the existing `esc`. No
  importer — output determinism only (spec §7.3).
- [ ] **Step 4: Run + compile + commit.**

```bash
git add lib/markdown.ts tests/markdown.test.ts
git commit -m "feat(cloze): export clozes as anki-style {{cN::...}} markdown"
```

## Task 13: Backup version bump + backward-compatible restore + validation

**Files:** Modify `lib/backup.ts`, `tests/backup.test.ts`.

- [ ] **Step 1: Failing tests** in `tests/backup.test.ts`:
  - A v1 backup (no clozes) still imports and its quotes load with `clozes` absent (parked).
  - A v2 backup with valid clozes round-trips.
  - A quote whose cloze array is malformed (overlap / out-of-range / missing id) imports
    with `clozes` dropped to `[]` rather than failing the whole import.
- [ ] **Step 2: Run to verify failure** (strict `formatVersion !== 2` would reject v1).
- [ ] **Step 3: Implement.**
  - Bump `BACKUP_FORMAT_VERSION = 2`.
  - In `readInboxPayload`, replace strict inequality with
    `if (typeof version !== 'number' || version > BACKUP_FORMAT_VERSION) throw ...` so any
    `version <= 2` is accepted.
  - Add `isCloze(value, textLength)` validating `0 <= start < end <= textLength`, `id`
    string, optional `hint` enum, optional `wordId` string, optional `review` via existing
    `isReviewState`. Extend `isQuoteEntry`: if `clozes` is present it must be an array;
    invalid/overlapping entries cause that quote's `clozes` to be sanitized to `[]`
    (sanitize inside `cloneInbox`, matching existing per-entry leniency). `cloneInbox`
    already deep-clones quotes, so valid clozes round-trip unchanged.
- [ ] **Step 4: Run + compile + commit.**

```bash
git add lib/backup.ts tests/backup.test.ts
git commit -m "feat(cloze): version backups and validate clozes on import"
```

## Task 14: Docs

**Files:** Modify `README.md`, `AGENTS.md`.

- [ ] **Step 1: README** — replace the "quote content shown immediately, no answer side"
  description with cloze review: a quote is reviewable only with a blank; each blank is its
  own card; parked quotes prompt to add a blank.
- [ ] **Step 2: AGENTS.md** — add the spec + this plan to the implementation list; document
  the per-cloze inline-state model and that quotes expand into cloze cards in `buildSrsQueue`;
  add new focused tests to the test list. Note the one-time quote scheduling reset.
- [ ] **Step 3: Commit.**

```bash
git add README.md AGENTS.md
git commit -m "docs(cloze): document cloze-deletion quote review"
```

---

## Task 15: Full verification

- [ ] **Step 1:** `npx vitest run tests/cloze.test.ts tests/capture.test.ts tests/srs.test.ts tests/review.test.ts tests/markdown.test.ts tests/backup.test.ts tests/review-queue.test.tsx tests/i18n.test.ts` — all pass.
- [ ] **Step 2:** `npm run compile` — exits 0.
- [ ] **Step 3:** `npm test` — full suite passes.
- [ ] **Step 4:** `npm run build && cat .output/chrome-mv3/manifest.json` — build exits 0;
  **no new permissions** (spec non-goal: no new network access).
- [ ] **Step 5:** `git status --short && git diff --check` — clean, no whitespace errors.

---

## Acceptance Criteria Traceability

| Requirement (spec) | Covered by |
|---|---|
| Quote reviewable iff ≥1 cloze | Tasks 3, 5 |
| Auto-suggest clozes from saved words | Tasks 2, 3, 10 |
| Manual add/edit/remove + hint per span | Task 10 |
| Each cloze is an independent FSRS card | Tasks 4, 5 |
| Quote with no clozes contributes no cards | Task 5 |
| Parked quotes surfaced with filter/count + affordance | Task 11 |
| New-card cap counts clozes | Task 5 |
| Front blanks only the active span; hints render | Task 8 |
| Reveal restores + highlights + note + TTS full quote | Task 8 |
| Rating updates only the active cloze | Tasks 4, 8 |
| Traditional toggle suppressed in review | Task 9 |
| Clozes survive backup/restore; v1 backups park | Task 13 |
| Markdown `{{cN::...}}` in document order | Task 12 |
| Offsets index Simplified text; no remap | Tasks 1, 8, 9 |
| No new network access / permissions | Task 15 |
