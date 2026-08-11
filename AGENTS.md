# Agent Instructions

## Project Summary

`shiyu-hanzi-box` (拾语汉字box) is a local-first Chrome MV3 extension built with
WXT. It captures selected Chinese text as words or quotes, keeps the working
inbox in `chrome.storage.local`, enriches and reviews it with FSRS spaced
repetition, and exports daily Markdown notes. It also supports first-class quote
tags, per-quote English translation, and optional encrypted provider-neutral
folder sync between browser profiles.

Design specs and implementation plans live in `docs/superpowers/specs/` and
`docs/superpowers/plans/`, named `YYYY-MM-DD-<topic>`. List those directories
rather than trusting any hardcoded index. `CHANGELOG.md` is the record of what
has shipped; do not maintain a parallel feature list here.

## Commands

From the repo root:

```bash
npm install
npm run dev
npm run build
npm run compile   # tsc --noEmit
npm test
npm run zip
```

Run a focused test with `npx vitest run <path>`, e.g.:

```bash
npx vitest run tests/capture.test.ts
npx vitest run tests/sync            # whole directory
```

Tests live in `tests/`, mirroring the module they cover (`lib/cloze.ts` →
`tests/cloze.test.ts`); `.test.tsx` files are component tests. List the
directory to find the right one.

Regenerate the CC-CEDICT compact asset under `public/dictionaries/`. Requires a
manually-downloaded `cc-cedict.txt`; see `docs/dictionaries/CC-CEDICT.md`.

```bash
npm run build:dictionary
```

## Architecture

### The capture data path

1. `entrypoints/background/index.ts` registers context menus and commands.
2. `entrypoints/background/capture-handler.ts` queries the active tab and runs
   `readPageContext` through `browser.scripting.executeScript`.
3. `lib/page-context.ts` reads selected text and page metadata in the page.
4. `lib/capture.ts` decides word vs quote behavior.
5. `lib/storage.ts` persists the inbox with WXT storage.
6. `entrypoints/dashboard/App.tsx` reads and mutates the inbox through
   `entrypoints/dashboard/hooks/useInbox.ts`.
7. `lib/markdown.ts` and `lib/export.ts` render daily notes and zip exports.

### Foundation

- `lib/types.ts`: persisted data shapes only.
- `lib/id.ts`: dependency-free id helper.
- `lib/normalize.ts`: pure text normalization for word dedupe.
- `lib/storage.ts`: `local:inbox` storage item and serialized mutations.
- `lib/settings.ts`: `local:settings` storage plus normalized read, watch,
  mutation, and replacement helpers so old installs gain nested defaults.
- `lib/i18n.ts`: the `en` / `zh-CN` message tables. Every user-facing string
  goes here; `tests/i18n-source.test.ts` enforces key parity and forbids
  `locale === 'en' ? …` ternaries under `entrypoints/`.

### Capture

- `lib/capture.ts`: `saveWord` and `saveQuote`. `saveQuote` saves quotes with no
  cloze blanks (parked); blanks are added later by the user. `sanitizeSource`
  blanks the source/surrounding (preserving `capturedAt` so undo still matches)
  when a capture comes from a blank / New Tab / browser-dashboard page; every
  capture path in `capture-handler.ts` runs `SourceInfo` through it.
- `lib/page-context.ts`: self-contained injected selection reader, plus
  `isBlankOrBrowserPage(url)` — a pure URL-scheme test for blank pages, New Tab
  Pages, and browser/extension internal pages, used by `sanitizeSource`.
- `entrypoints/popup/Popup.tsx`: toolbar capture buttons.

### Word enrichment

Definitions, tone chips, highlighted source examples, and external dictionary
links are computed at view time and never persisted on `WordEntry`.

- `lib/dictionary.ts`: CC-CEDICT parsing, compact asset build/materialize,
  lookup index, exact lookup, and component fallback segmentation.
- `lib/dictionary-cache.ts`: IndexedDB cache for the parsed index, keyed by the
  asset hash.
- `lib/dictionary-loader.ts`: dashboard-only fetch + cache hydrate/build for the
  compact asset under `public/dictionaries/`; it keeps CC-CEDICT/Kaikki English
  entries and the optional CVDICT Vietnamese index separate.
- `lib/cvdict.ts` / `lib/cvdict-cache.ts`: fixed-source CVDICT validation and a
  local IndexedDB cache. `entrypoints/settings/cvdict-install.worker.ts` is the
  explicit-click worker that streams, parses, and writes that cache.
- `lib/word-insight.ts`: pure composition of dictionary, tone chips, source
  examples, and external links into a `WordInsight`.
- `lib/pinyin.ts` / `lib/pinyin-helpers.ts`: `pinyin-pro` wrapper for lazy
  dashboard pinyin; CC-CEDICT numbered pinyin → tone marks/numbers, with a
  pinyin-pro fallback when no dictionary match exists.
- `lib/traditional.ts`: `opencc-js` wrapper for lazy Simplified → Taiwan
  Traditional conversion (`cn -> twp`), cached on `EntryBase.traditionalText`
  after an explicit click.
- `lib/external-dictionaries.ts`: click-only encoded Youdao and 百度汉语 URLs,
  plus Hanzii only while CVDICT is enabled. These links never fetch until clicked.
- `lib/kaikki.ts`: Kaikki JSONL parser, streaming parser, URL validation, and
  entry hashing. It intentionally filters records with no Han characters or no
  usable `glosses` / `raw_glosses` — progress UI must call these *filtered*
  records, not failed imports. Definition-bearing records may index
  Han-character `forms` as runtime lookup variants; no-gloss soft redirects stay
  filtered unless the target definition appears on another record with that form.
- `entrypoints/settings/kaikki-import.worker.ts`: streams a user-selected JSONL
  file off the settings UI thread, reports progress, builds the fallback index,
  and stores it in IndexedDB.
- `entrypoints/dashboard/components/WordInsightPanel.tsx`,
  `hooks/useWordInsight.ts`: the panel inside `WordCard`; the hook loads the
  dictionary once per dashboard session and computes insight per word.

### AI (opt-in, BYO key)

Every AI result requires an explicit user click. `lib/ai/settings.ts` holds
`local:aiSettings` and the provider preset table; `lib/ai/client.ts` is the
single `fetch` to `${baseUrl}/chat/completions` with typed error handling;
`lib/ai/permissions.ts` lazily requests the configured provider origin.

- `lib/ai/prompt.ts` / `lib/ai/parse.ts`: language-specific word insight. AI ·
  EN persists on `WordEntry.aiInsight`; AI · VI persists independently on
  `WordEntry.aiVietnameseInsight` and receives only CVDICT grounding.
- `lib/ai/cloze-prompt.ts` / `lib/ai/cloze-parse.ts`: cloze suggestions
  (建议填空).
- `lib/ai/translate-prompt.ts` / `lib/ai/translate-parse.ts`: quote translation,
  backing `fetchAiTranslation`.
- `entrypoints/settings/AiSettingsPanel.tsx`: provider picker, masked key,
  model, test connection.
- `entrypoints/dashboard/components/AskAiButton.tsx`,
  `AiInsightSection.tsx`, `hooks/useAiInsight.ts`.

### Quote translation

`lib/translate/*` plus the `lib/ai/translate-*` pair give each quote two
independent English translation paths, stored as two slots on
`QuoteEntry.translations`.

- `lib/translate/types.ts`: `TranslateFailure` codes and the shared
  `TranslateResult`. Failures are codes, never prose, so the UI can localize.
- `lib/translate/google-parse.ts`: pure parser for Google's undocumented
  `translate_a/single?client=gtx` response. Element `[0]` holds one entry per
  sentence segment, so a multi-sentence quote arrives split and must be rejoined
  in order.
- `lib/translate/google.ts`: single `fetch` to the keyless gtx endpoint with
  status classification. Permission-unaware by design, so it is testable with
  only a mocked `fetch`.
- `lib/translate/permissions.ts`: the optional `translate.googleapis.com` host
  grant, requested by the hook on click. `GOOGLE_TRANSLATE_ORIGIN` must stay
  character-identical to the `optional_host_permissions` entry in
  `wxt.config.ts`, or the request silently fails at runtime.
- `entrypoints/dashboard/hooks/useQuoteTranslation.ts`: owns both request paths,
  the permission gesture, and the single storage write. Writes are serialized
  behind a module-level promise chain — `requestSyncMutation` resolves only after
  the background worker's `setInbox`, so an unserialized second read can capture
  a pre-write snapshot and erase the sibling slot.
- `entrypoints/dashboard/components/TranslateButtons.tsx`: purely
  presentational, all state via props.

A translation is **write-once**. Once a slot is filled its chip becomes a
show/hide toggle with no regenerate action, and an absent slot merges as "no
opinion" rather than a clear, so there is no way to delete one either. This is
deliberate, mirroring Traditional (繁) conversion. Adding a regenerate
affordance would break the invariant that no request can fire on a filled slot.

### Review and SRS

- `lib/srs.ts`: the only importer of `ts-fsrs`. Scheduler construction,
  ReviewState/Card conversion, lazy migration of legacy review state, ratings,
  postpone, due queue, wake time, and minute-scale learning steps. `buildSrsQueue`
  expands each `QuoteEntry` into one queue item per cloze; quotes with no clozes
  are skipped (parked). Cloze FSRS state lives inline on `Cloze.review` — there
  is no separate keyed card store. The legacy top-level `QuoteEntry.review` field
  is ignored for scheduling (a one-time reset) and need not be cleared.
- `lib/review.ts`: compatibility wrapper delegating queue building to `lib/srs.ts`.
- `lib/cloze.ts`: the only file that may define or validate cloze shapes. Type
  guards, overlap detection, brace-markup parsing (`parseClozeMarkup` /
  `seedMarkup`), hint types (none / pinyin / length), and Anki-style
  `{{cN::…}}` Markdown rendering. Quotes save parked on capture; blanks are added
  manually (wrap spans in `{ }` and Apply) or via AI suggestions.
- `lib/review-stats.ts`: pure derivation of the Stats tab from persisted review
  history. `computeReviewStats` composes the streak (one grace-day freeze,
  future-day guard), the 84-day zero-filled heatmap ending today, the 7-day due
  forecast (overdue folds into today), and lifetime totals. Read-only — it never
  schedules or mutates.
- `entrypoints/dashboard/components/ReviewQueue.tsx`: renders only the first
  filtered due card. Rating/postpone updates storage and the recalculated queue
  supplies the next card.
- `entrypoints/dashboard/components/ReviewStatsTab.tsx`,
  `ReviewInsightReveal.tsx`, `ClozeEditor.tsx`.

### Tags

`lib/tags.ts` is the only owner of tag behavior: normalization (lowercase, trim,
collapse internal whitespace, dedupe), add/remove, frequency counts, and the
one-time `category` → `tags` migration. `QuoteEntry.tags` is a plain `string[]`;
`category` has been removed. The tag-chip editor on `QuoteCard`, the OR-semantics
filter in `App.tsx`, and `components/TagCloud.tsx` all route writes through it.
Tags display during review and in Markdown export.

### Sync (optional, encrypted, provider-neutral)

`chrome.storage.local` stays authoritative; the user-selected folder is an
encrypted replica transport reached through the File System Access API — no
provider API is ever called.

- `lib/sync/types.ts`: the CRDT `SyncState` — HLC-stamped LWW registers plus
  add-wins OR-Sets (occurrences, review events, quote tags, cloze blanks).
- `lib/sync/project.ts`: projects inbox ↔ state. Tag add-stamps are carried
  forward so unrelated edits never move them. Quote translations project as
  **two separate registers** (`translationGoogle`, `translationAi`) so
  translating with different sources on two devices never loses one, each
  stamped by its slot's own `generatedAt` rather than the quote's `updatedAt` so
  an unrelated edit cannot revert a peer's newer translation. An absent slot
  emits no register at all — never `null`, which could otherwise erase a peer.
  Cloze blanks project as one node per blank (LWW span/hint/wordId plus its own
  review events and scheduler snapshot — one blank is one FSRS card), keyed by
  `Cloze.id` with carried-forward add stamps like tags. **Anything a quote or
  word carries must be projected**: `materialize` rebuilds each entry as a
  fresh literal and the coordinator writes it over the local inbox, so an
  unprojected field is deleted on the next pass, not merely left unsynced —
  `tests/sync/project.test.ts` round-trips a fully-populated quote to catch it.
- `lib/sync/merge.ts`: the deterministic merge. `coordinator.ts`: the sole
  writer, debounced. `connect.ts`: create/join vault and folder authorization.
  `crypto.ts` / `vault.ts`: encrypt the whole payload (including the AI key)
  under a passphrase whose derived key is remembered locally. `files.ts`: folder
  I/O. `local.ts`: `local:syncConfig`. `mutations.ts`: `local:syncMetadata` and
  queued mutations.
- OR-Set members (tags, cloze blanks, occurrences) are removed by an explicit
  tombstone mutation, never by dropping them from the inbox — absence merges as
  "no opinion", so a peer resurrects them. Any write path that can drop a member
  must plan its removals off the same snapshot it writes: the dashboard edits
  via `useInbox.mutateWithRemovals`, a backup restore via
  `lib/sync/restore.ts` `planRestoreRemovals`.
- Sync triggers: on change, on UI startup, on a background `alarms` wakeup
  (`entrypoints/background/sync-mutation-handler.ts`), and on demand.
- `entrypoints/dashboard/SyncStatusBadge.tsx` shows state;
  `entrypoints/settings/FolderSync.tsx` is the settings UI.
- Each profile writes only its own replica. Kaikki and CVDICT indexes (including
  their IndexedDB caches), plus the remembered key, never sync. Full backups may
  retain CVDICT settings metadata but not its local index.

### Export and backup

- `lib/markdown.ts`: pure daily Markdown rendering.
- `lib/export.ts`: daily export map and zip byte generation.
- `lib/backup.ts`: versioned JSON backup. `BACKUP_FORMAT_VERSION` (2) is
  inbox-only; `FULL_BACKUP_FORMAT_VERSION` (3) also carries `AppSettings` and
  `AiSettings` including the API key. Restore validates each version and treats
  unknown/lower versions as inbox-only. v1 backups still import (their quotes
  load parked, carrying no cloze arrays); malformed cloze arrays are sanitized to
  `[]` on import and the quote is preserved. Optional fields added after v1 are
  deliberately not validated — `cloneJson` preserves them on round-trip.

## Conventions

- Keep capture behavior funneled through `lib/capture.ts`; do not duplicate
  dedupe or storage writes in UI entrypoints.
- Keep injected functions self-contained. `readPageContext` must not depend on
  imported closure state because it is serialized into the active tab.
- Blank the source of captures from non-content pages. Route every `SourceInfo`
  through `sanitizeSource` (backed by `isBlankOrBrowserPage`).
- Prefer pure modules for behavior that can be unit-tested without Chrome APIs.
- Keep all scheduler calls and `ts-fsrs` imports inside `lib/srs.ts`.
- Treat the SRS queue as the review-session source of truth; do not persist a
  separate current-card index. Keep SRS state local on each entry and never use
  it for capture dedupe.
- In Review, hide word insight until Reveal. For quote cloze cards, hide the
  active blank on the front (hint-aware) and reveal the full quote with the
  answer highlighted. The Traditional (繁) toggle is suppressed for quote cloze
  cards because cloze offsets index Simplified text.
- Funnel all tag reads/writes through `lib/tags.ts`; normalize before persisting
  and never reintroduce the removed `category` field.
- Route local mutations that must sync through the `lib/sync` coordinator (the
  sole writer). Keep `chrome.storage.local` authoritative; the folder is a
  transport. Do not sync Kaikki data or the remembered key.
- Keep Traditional conversion and quote translation as display/export
  annotations. Do not use `traditionalText` or `QuoteEntry.translations` for
  capture, normalize, dedupe, review scheduling, cloze offsets, or zip export
  behavior. Translate `quote.text` (Simplified), never `traditionalText`.
- Write the two translation slots independently; filling one must never clear the
  other. A failed request writes nothing.
- Return `TranslateFailure` codes from the translate layer and localize them in
  the component. Do not surface raw provider prose as the primary message.
- Request the relevant host permission from a user gesture before any provider
  fetch — the grant may be absent even when settings look configured, because
  AI settings sync between profiles without one.
- Use `@/*` imports where existing WXT code does, and relative imports where the
  file already uses that style.
- Use `apply_patch` for manual edits.
- Do not revert user changes. Check `git status --short` before editing.

## WXT And Fake-Browser Notes

- For WXT `0.20.26`, import storage from `wxt/utils/storage`, not `wxt/storage`.
- For WXT browser types:

```ts
import type { Browser } from 'wxt/browser';
type ActiveTab = Browser.tabs.Tab;
```

- `@webext-core/fake-browser` does not expose `setReturnValue` / `setReject`.
  Use Vitest spies instead:

```ts
vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([...]);
vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([...]);
```

- `fakeBrowser.reset()` clears storage and event state between tests.
- Vitest here transforms with esbuild and does **not** type-check. A test that
  should fail on a type error will pass; only `npm run compile` catches it.

## Testing Expectations

- Use TDD for behavior changes and new modules when practical.
- Run the focused test for the files you changed.
- Before claiming work is complete, run at least:

```bash
npm run compile
npm test
```

- For manifest/background changes, also run:

```bash
npm run build
cat .output/chrome-mv3/manifest.json
```

Expected manifest features: `contextMenus`, `storage`, `activeTab`, `scripting`,
`downloads`, `unlimitedStorage`, `alarms` (background folder sync),
`clipboardRead`, `tts`, command shortcuts, a toolbar popup, and an MV3 background
service worker. Provider and translation host access are
`optional_host_permissions`, never `permissions`.
