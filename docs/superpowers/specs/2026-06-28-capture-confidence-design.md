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

In `saveQuote`, compute `normalizeText(trimmed)` and scan existing quotes for a
match (`normalizeText(q.text) === key`). `normalizeText` collapses whitespace,
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
  page). It reads its data from `executeScript` `args` and uses
  `chrome.runtime.sendMessage` (available in the isolated content world) for
  Undo.
- **Localization**: the injected renderer can't import the app i18n module
  (serialization). Pass the already-resolved label strings as args, chosen in
  the background from the user's UI locale (`en` / `zh-CN`).
- **Badge**: keep `setBadge(...)` as today. It is the always-available signal
  (and the only feedback on restricted pages where injection is impossible).

### D. Undo (background reversal)

The toast's Undo button sends a runtime message to the background:

```ts
{ type: 'undo-capture', kind: 'word' | 'quote',
  action: WordAction | QuoteAction, entryId: string,
  occurrenceCapturedAt?: number }
```

A new `onMessage` handler in `entrypoints/background/index.ts` (matching the
existing message-listener pattern) reverses the action:

- `created` (word or quote) → delete the entry via the existing CRDT-tombstone
  path `applyDeletion([<entityKey(entryId)>])`, so the deletion survives sync and
  the entry is not resurrected on merge.
- `occurrence-added` (word) → remove the just-added occurrence (matched by
  `occurrenceCapturedAt`) from the word. Because `occurrences` is an add-wins
  OR-Set, this goes through an OR-Set-aware removal that writes a remove
  tombstone — a new `removeOccurrence` mutation modeled on the existing
  `removeTags` path. (If the implementation plan needs to trim scope, the
  documented fallback is to not offer Undo on `occurrence-added` and only
  confirm it; `created` undo is the must-have.)
- `duplicate` → no message is sent (Undo is not shown).

Undo is best-effort and idempotent: if the entry is already gone, the handler
is a no-op. The handler returns a small `{ ok }` ack the toast can use to switch
to an "已撤销 / Undone" state before dismissing.

### E. Popup manual-capture path

The popup paste-fallback (`handleManualCapture`) runs while the popup is open,
so it does not use a page toast. Instead, `handleManualCapture` returns the
`CaptureOutcome` to the popup, and the popup renders an inline confirmation
(captured text + type) with an **Undo** button that calls the same
`undo-capture` flow. `duplicate` shows "已存在" without Undo.

### F. Restricted pages / injection failure

If `executeScript` for the toast throws (chrome:// and other restricted pages),
fall back to the existing badge only — no toast, no error surfaced to the user.
The capture itself already has its own restricted-page handling and badge.

## Data flow

```
context menu / command
  -> capture-handler.captureActiveTab(kind)
       -> saveWord/saveQuote  => CaptureOutcome
  -> setBadge(...)                         (unchanged)
  -> if outcome and tab scriptable:
       executeScript(renderToast, args=[type, label, text, action, entryId, occAt])
            toast Undo click -> runtime.sendMessage({type:'undo-capture', ...})
  background onMessage('undo-capture')
       -> created: applyDeletion([key])
       -> occurrence-added: removeOccurrence(wordId, occAt)
       -> ack {ok}
```

## Components touched

- `lib/capture.ts` — outcome types; quote dedupe; word action reporting.
- `lib/capture-toast.ts` (new) — self-contained injected toast renderer + the
  shared `CaptureOutcome`/message types and label selection helper.
- `entrypoints/background/capture-handler.ts` — propagate outcome; inject toast
  on success; keep badge; restricted-page fallback.
- `entrypoints/background/index.ts` — `undo-capture` message handler.
- `lib/sync/mutations.ts` — `removeOccurrence` OR-Set removal (mirrors
  `removeTags`); reuse `applyDeletion` for entry deletion.
- `entrypoints/popup/Popup.tsx` — inline confirm + Undo for the manual path.

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
  - `created` → `applyDeletion` called with the entry key; entry removed.
  - `occurrence-added` → occurrence with the given `capturedAt` removed; OR-Set
    remove tombstone written.
  - missing entry → no-op ack.
- Toast renderer: light unit test of the pure label-selection helper; DOM
  construction smoke-tested (Shadow root created, Undo present only when the
  action is undoable).
- Full suite (`npm run compile && npm test`) green; `npm run build` +
  manifest check (no new permissions expected — toast uses existing `scripting`;
  undo uses runtime messaging).

## Risks / considerations

- **OR-Set occurrence removal** is the only piece touching the sync layer; it
  mirrors `removeTags`. Fallback (drop `occurrence-added` undo) is documented.
- **Injected renderer serialization**: the toast function must not close over
  imports; all data and localized strings arrive via `args`.
- **No new permissions**: confirm the build manifest is unchanged.
```
