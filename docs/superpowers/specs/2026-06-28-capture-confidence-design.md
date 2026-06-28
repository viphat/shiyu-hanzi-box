# Capture Confidence (v0.2.1) — Design

Last updated: 2026-06-28

## Summary

v0.2.1 makes capture trustworthy. After a user saves a word or quote, the
extension shows **what** was captured directly on the page and lets the user
**undo** it immediately, and it stops **quotes** from being silently saved
twice. Today the only capture feedback is a 1.5s toolbar badge
(`WORD`/`QTE`/`FAIL`), there is no undo, and `saveQuote` creates a brand-new
entry on every call with no de-duplication.

This release is three coordinated changes under one theme — "trust what you
captured":

1. Capture functions report the action they took (foundation for undo).
2. Quotes de-duplicate globally by normalized text.
3. An in-page confirmation toast shows the capture and offers Undo.

Onboarding is explicitly **out of scope** for v0.2.1 (deferred to a later
release).

## Goals

- The user can see the captured text and its type (word / quote) without
  opening the dashboard.
- The user can undo a capture with one click, immediately after it happens.
- Accidentally capturing the same quote twice does not create a duplicate.
- No regression to the local-first, sync, or restricted-page behavior.

## Non-goals

- First-run onboarding (separate, larger effort).
- Giving quotes an `occurrences[]` multi-source model. Quotes keep their single
  source; a duplicate capture is suppressed, not merged.
- Changing word de-duplication, which already works (normalized-text dedupe plus
  a 5s duplicate-occurrence guard).
- A persistent capture history UI in the popup.

## Current behavior (baseline)

- `lib/capture.ts`
  - `saveWord(text, src)` returns `WordEntry | null`. It dedupes by
    `normalized = normalizeText(text)`: creates a new word, or appends an
    `Occurrence` to the existing word, or suppresses a duplicate occurrence
    (same `sourceUrl` + `surrounding` within `DEDUPE_WINDOW_MS = 5000`).
  - `saveQuote(text, src)` returns `QuoteEntry | null`. It **always** creates a
    new quote (parked, no clozes). No dedupe.
- `entrypoints/background/capture-handler.ts` runs capture from the context
  menu, keyboard command, and popup manual fallback, then calls `setBadge(...)`.
- Sync: `chrome.storage.local` is authoritative. Mutations go through
  `mutateInboxSynced` / `requestSyncMutation('inbox', …)`. Deletions use
  `applyDeletion(keys)` (CRDT tombstone). `occurrences`, review events, and quote
  tags are add-wins OR-Sets; tag removals use a dedicated `removeTags` path.

## Design

### A. Capture outcome model

Change `saveWord` and `saveQuote` to return a small outcome object instead of
`entry | null`, so the caller knows exactly what to reverse.

```ts
// lib/capture.ts
export type WordAction = 'created' | 'occurrence-added' | 'duplicate';
export type QuoteAction = 'created' | 'duplicate';

export interface CaptureOutcome<E, A> {
  entry: E;                 // the resulting (new or existing) entry
  action: A;
  /** For 'occurrence-added': identifies the occurrence to remove on undo. */
  occurrenceCapturedAt?: number;
}

// Empty/whitespace input still yields null (nothing was captured).
export function saveWord(text, src): Promise<CaptureOutcome<WordEntry, WordAction> | null>;
export function saveQuote(text, src): Promise<CaptureOutcome<QuoteEntry, QuoteAction> | null>;
```

Action mapping:

- `saveWord`: new word → `created`; appended occurrence → `occurrence-added`
  (with `occurrenceCapturedAt = src.capturedAt`); suppressed duplicate
  occurrence → `duplicate`.
- `saveQuote`: new quote → `created`; suppressed by dedupe (see B) →
  `duplicate`.

### B. Quote de-duplication (global, by normalized text)

In `saveQuote`, compute `normalizeText(trimmed)` and, **inside the
`mutateInboxSynced` mutator** (on the freshly-read inbox, the way `saveWord`'s
`findIndex` already runs inside its mutator — `lib/capture.ts`), scan existing
quotes for a match (`normalizeText(q.text) === key`). Computing the key inside
the mutator avoids a TOCTOU race where a concurrent capture creates the quote
between the scan and the write. `normalizeText` collapses whitespace,
lowercases, and strips edge punctuation while preserving internal CJK
punctuation — the right granularity for "the same sentence."

- Match found → do **not** create a new quote; leave the existing quote
  untouched (no source merge, no `updatedAt` bump). Return
  `{ entry: existing, action: 'duplicate' }`.
- No match → create as today. Return `{ entry: newQuote, action: 'created' }`.

The normalized key is computed **on the fly** at capture time; `QuoteEntry`
gains **no** persisted `normalized` field. Rationale: keeps the patch contained
(no type/projection/backup/migration changes); the linear scan is negligible at
realistic collection sizes. (Future optimization, if ever needed: store
`normalized` on `QuoteEntry` like `WordEntry`.)

### C. In-page confirmation toast

After a capture on the scripting path (context menu / keyboard command), inject
a self-contained toast renderer into the active tab via
`browser.scripting.executeScript`, passing the outcome as args (type, display
text, action, entry id, optional `occurrenceCapturedAt`).

- **Rendering**: a small themed toast pinned bottom-right, mounted inside a
  **Shadow DOM** root so page CSS cannot bleed in or out, with a high
  `z-index`. Jade/cinnabar/cream tokens consistent with the extension. Auto-
  dismisses after ~6s (longer than the old 1.5s badge, to leave time to undo).
  Re-invoking replaces any existing toast (single instance).
- **Content by action**:
  - word `created`: "已保存为词 · {text}" + **撤销 / Undo**
  - word `occurrence-added`: "已记录新出处 · {text}" + **撤销 / Undo**
  - quote `created`: "已保存为句 · {truncated text}" + **撤销 / Undo**
  - `duplicate` (quote, or word duplicate occurrence): "已存在 · {truncated
    text}" — no Undo (nothing was added). Optional dismiss only.
  - Long quote text is truncated for display (e.g. ~40 chars + ellipsis).
- **Injected function constraints** (per repo conventions): the renderer must be
  fully self-contained (no imported closure state — it is serialized into the
  page). It reads its data from `executeScript` `args`. The injected `func` runs
  in the **isolated content world** (the `executeScript` default), where
  `chrome.runtime.sendMessage` is available; it uses that to send the
  `undo-capture` message for Undo. Note the capture path already proved the tab
  scriptable via the earlier `readPageContext` injection, so the toast injection
  reuses a known-good target.
- **Localization**: the injected renderer can't import the app i18n module
  (serialization). Pass the already-resolved label strings as args, chosen in
  the background from the user's UI locale (`en` / `zh-CN`).
- **Badge**: keep `setBadge(...)` as today. It is the always-available signal
  (and the only feedback on restricted pages where injection is impossible).

### D. Undo (background reversal)

The toast's Undo button reverses the capture by issuing the **same mutations the
rest of the app uses** — it does **not** introduce a bespoke handler. Undo is
routed through the existing `requestSyncMutation` / `sync-mutation-handler`
pipeline (`entrypoints/background/sync-mutation-handler.ts`). This matters for
correctness, not just consistency: `writeKind` pairs every mutation with
`scheduleDebouncedSync()`, so a deletion issued this way is actually flushed to
the vault. A hand-rolled handler that called `applyDeletion` directly would
write the tombstone but never schedule the flush, leaving the undo unsynced until
an unrelated mutation or the 5-minute alarm fired.

The toast (isolated world) sends a single runtime message; a thin `undo-capture`
listener in the background translates it into the appropriate
`requestSyncMutation(...)` call(s) and returns the ack:

```ts
{ type: 'undo-capture',
  kind: 'word' | 'quote',
  action: WordAction | QuoteAction,
  // For 'created' quote: entryId is the quote id.
  // For 'created' word: normalized is required (see below); entryId is informational.
  entryId: string,
  normalized?: string,
  // Full occurrence tuple needed to recompute the OR-Set element id (see below).
  occurrence?: { sourceUrl: string; surrounding: string; capturedAt: number } }
```

Reversal by action:

- **`created` quote** → `requestSyncMutation('delete', ['quote:' + entryId])`.
  Quotes are tombstoned by id; this matches the projection's suppression key
  (`state.tombstones['quote:' + id]`, `lib/sync/project.ts`) and the dashboard's
  existing quote-delete (`App.tsx`). Also drop the quote from `inbox.quotes` via
  an `inbox` mutation, mirroring how the dashboard pairs a delete with the inbox
  write.
- **`created` word** → words are **not** keyed by id. The sync state keys a word
  node — and its tombstone — by `word:<normalized>` (`wordKey`, and the
  suppression check at `lib/sync/project.ts`). So undo must delete
  `requestSyncMutation('delete', ['word:' + normalized])`, **not** `word:<id>`;
  an id-based key would write a tombstone that never matches the projected key
  and the word would resurrect on the next merge. The `normalized` value is
  carried in the undo message (the toast already has it from the outcome's
  entry). Also drop the word from `inbox.words`.
- **`occurrence-added` (word)** → remove just the appended occurrence, leaving
  the word (which, by definition of `occurrence-added`, pre-existed with ≥1 other
  occurrence). This is an add-wins OR-Set removal that writes a remove tombstone,
  added as a **new `removeOccurrence` kind** in `sync-mutation-handler.ts`,
  modeled on the existing `removeTags` path (which already pairs a `tagTombstones`
  write with the inbox write off a single snapshot — `useInbox.ts`). The OR-Set
  infrastructure already exists: `WordNode.occurrenceTombstones`,
  `mergeOccurrences`, and `mergeStampMap` (`lib/sync/types.ts`, `lib/sync/merge.ts`).

  Critically, the occurrence's OR-Set element id is **derived, not stored**:
  `legacyOccurrenceId(wordId, occ) = 'occ:' + fnv1a(wordId|sourceUrl|surrounding|capturedAt)`
  (`lib/sync/project.ts`), and the local `Occurrence` type carries no id field
  (`lib/types.ts`). So `capturedAt` alone is insufficient to key the tombstone —
  the handler needs the full `{ sourceUrl, surrounding, capturedAt }` tuple plus
  the word id to recompute the element id. The `removeOccurrence` mutation
  therefore: reads the inbox, locates the word and the occurrence matching the
  tuple, recomputes `legacyOccurrenceId`, writes that key into the word node's
  `occurrenceTombstones`, **and** removes the occurrence from `inbox.words[…].occurrences`
  — both off the same snapshot, exactly as `removeTags` does. (Matching an
  occurrence by `capturedAt` is unambiguous in practice: `capturedAt` is
  `Date.now()` at capture time, distinct per user action; the full tuple makes it
  exact.)

  Scope-trim fallback (documented): if `removeOccurrence` proves too large, drop
  Undo on `occurrence-added` and only confirm it (no Undo button). `created`
  undo is the must-have.
- **`duplicate`** → no message is sent (Undo is not shown).

Undo is best-effort and idempotent: if the entry/occurrence is already gone, the
mutation is a no-op (the CRDT tombstone write and the inbox filter both tolerate
a missing target). The `sync-mutation-handler` already resolves with `{ ok: true }`,
which the toast uses to switch to an "已撤销 / Undone" state before dismissing.

### E. Popup manual-capture path

The popup paste-fallback (`handleManualCapture`) runs while the popup is open,
so it does not use a page toast. Instead, `handleManualCapture` returns the
`CaptureOutcome` to the popup, and the popup renders an inline confirmation
(captured text + type) with an **Undo** button. The popup is not in the
background context, so rather than send an `undo-capture` message it calls
`requestSyncMutation(...)` directly with the same `delete` / `removeOccurrence`
kinds and key rules described in D (quote → `quote:<id>`, word → `word:<normalized>`).
`duplicate` shows "已存在" without Undo.

### F. Restricted pages / injection failure

Toast injection is only reached on a path that already captured successfully via
scripting (`captureActiveTab` ran `readPageContext` on the same tab first), so the
tab is proven scriptable and injection will essentially always succeed. The
genuinely restricted cases never reach injection:

- The context-menu handler's selectionText fallback (`handleContextMenuCapture`,
  `entrypoints/background/capture-handler.ts`) fires only when
  `captureActiveTab` returned `restricted-page`; that branch saves via
  `saveSelectedText` and stays **badge-only** — no toast. It should still thread
  the `CaptureOutcome` through (so the badge logic and any future use are
  consistent), but it does not attempt injection.
- Keyboard command / context-menu on a normal page → toast injected.

Defensively, the toast `executeScript` is still wrapped in try/catch: on any
throw, fall back to the badge only — no toast, no error surfaced. (Given the
above, this catch is belt-and-suspenders rather than the primary restricted-page
mechanism.)

## Data flow

```
context menu / command
  -> capture-handler.captureActiveTab(kind)        (keyboard cmd, + ctx-menu happy path)
       -> saveWord/saveQuote  => CaptureOutcome
  -> setBadge(...)                                 (unchanged)
  -> if outcome and tab scriptable:
       executeScript(renderToast,
         args=[type, label, text, action, entryId, normalized?, occurrence?])
            toast Undo click (isolated world)
              -> runtime.sendMessage({type:'undo-capture', ...})
  background 'undo-capture' listener -> requestSyncMutation(...)  (-> sync-mutation-handler)
       -> created quote:  delete ['quote:'+id]      + inbox (drop quote)
       -> created word:   delete ['word:'+normalized] + inbox (drop word)
       -> occurrence-added: removeOccurrence (recompute legacyOccurrenceId) + inbox
       -> writeKind also schedules debounced sync; resolves {ok:true}

ctx-menu restricted-page fallback (handleContextMenuCapture):
  -> saveSelectedText => CaptureOutcome ; setBadge(...) only ; no toast
```

## Components touched

- `lib/capture.ts` — outcome types; quote dedupe; word action reporting.
- `lib/capture-toast.ts` (new) — self-contained injected toast renderer + the
  shared `CaptureOutcome`/message types and label selection helper.
- `entrypoints/background/capture-handler.ts` — propagate outcome through both
  `captureActiveTab` and the `handleContextMenuCapture` selectionText fallback;
  inject toast on the scriptable success path; keep badge; restricted-page stays
  badge-only.
- `entrypoints/background/index.ts` — thin `undo-capture` message listener that
  translates the message into `requestSyncMutation(...)` calls (must return a
  promise so the toast receives the `{ ok }` ack).
- `entrypoints/background/sync-mutation-handler.ts` — add `removeOccurrence` to
  the `kind` union and `writeKind` (so it also gets `scheduleDebouncedSync`);
  reuse the existing `delete` kind for entry deletion.
- `lib/sync/mutations.ts` — `removeOccurrence` OR-Set removal (mirrors
  `applyTagRemoval`: recompute `legacyOccurrenceId`, write `occurrenceTombstones`,
  drop from `inbox.words[…].occurrences` off one snapshot).
- `entrypoints/popup/Popup.tsx` — inline confirm + Undo for the manual path,
  calling `requestSyncMutation` directly (popup is not the background context).

## Testing

- `lib/capture` (extend `tests/capture.test.ts`):
  - quote dedupe: identical text suppressed (`duplicate`); whitespace/edge-
    punctuation variants treated as duplicates; genuinely different quotes still
    create; existing quote left untouched (no `updatedAt` change).
  - word actions: `created`, `occurrence-added` (with `occurrenceCapturedAt`),
    `duplicate`.
- `capture-handler` (extend `tests/capture-handler.test.ts`):
  - toast injected on success (spy `scripting.executeScript`); not injected /
    no throw on restricted page; badge still set in all paths.
- Undo (new test):
  - `created` quote → tombstone written under `quote:<id>`; entry dropped from
    inbox; quote suppressed after re-projection.
  - `created` word → tombstone written under `word:<normalized>` (regression
    guard: an id-based key must NOT suppress the word — assert the projected key
    is the normalized one); entry dropped from inbox.
  - `occurrence-added` → `removeOccurrence` recomputes `legacyOccurrenceId` from
    the `{ sourceUrl, surrounding, capturedAt }` tuple + word id, writes that key
    into `occurrenceTombstones`, and removes the occurrence from the inbox; the
    occurrence is suppressed after re-projection while the word and its other
    occurrences survive.
  - missing entry / occurrence → no-op, still resolves `{ ok: true }`.
  - undo routes through `sync-mutation-handler` so debounced sync is scheduled
    (spy `scheduleDebouncedSync` / the alarm create).
- Toast renderer: light unit test of the pure label-selection helper; DOM
  construction smoke-tested (Shadow root created, Undo present only when the
  action is undoable).
- Full suite (`npm run compile && npm test`) green; `npm run build` +
  manifest check (no new permissions expected — toast uses existing `scripting`;
  undo uses runtime messaging).

## Risks / considerations

- **Tombstone key asymmetry** (highest-risk correctness item): quotes are keyed
  by `quote:<id>` but words by `word:<normalized>`. Undo of a `created` word must
  use the normalized key or the deletion silently no-ops and the word resurrects
  on merge. Covered by a dedicated regression test.
- **Derived occurrence id**: the OR-Set element id is
  `legacyOccurrenceId(wordId, occ)`, not stored on the `Occurrence`; the undo
  payload carries the full `{ sourceUrl, surrounding, capturedAt }` tuple so the
  handler can recompute it.
- **Routing through `sync-mutation-handler`**: undo must not call `applyDeletion`
  directly from a bespoke handler — that would skip `scheduleDebouncedSync` and
  leave the undo unflushed. Always go via `requestSyncMutation`.
- **OR-Set occurrence removal** is the only piece adding to the sync layer; it
  mirrors `applyTagRemoval` (dual write: tombstone + inbox, off one snapshot).
  Fallback (drop `occurrence-added` undo) is documented.
- **Injected renderer serialization**: the toast function must not close over
  imports; all data and localized strings arrive via `args`.
- **No new permissions**: `scripting` is already used by capture; undo uses
  runtime messaging. Confirm the build manifest is unchanged.
```
