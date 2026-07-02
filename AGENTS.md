# Agent Instructions

## Project Summary

This repo is `shiyu-hanzi-box`, a local-first Chrome MV3 extension named
拾语汉字box. Its job is to capture selected Chinese text as words or quotes,
store the working inbox in `chrome.storage.local`, enrich and review it, and
export daily Markdown notes. It also supports first-class quote tags and
optional encrypted provider-neutral folder sync between browser profiles.

The implementation plans and specs are in `docs/superpowers/`:

- `plans/2026-06-20-shiyu-hanzi-box.md`
- `specs/2026-06-20-shiyu-hanzi-box-design.md`
- `plans/2026-06-21-word-insight-panel-ai.md`
- `plans/2026-06-22-optional-dashboard-access.md`
- `specs/2026-06-22-traditional-chinese-conversion-design.md`
- `plans/2026-06-22-traditional-chinese-conversion.md`
- `specs/2026-06-22-real-srs-system-design.md`
- `plans/2026-06-24-real-srs-system.md`
- `specs/2026-06-24-single-card-review-design.md`
- `plans/2026-06-24-single-card-review.md`
- `specs/2026-06-25-quote-review-cloze-design.md`
- `plans/2026-06-25-quote-review-cloze.md`
- `specs/2026-06-25-encrypted-folder-sync-design.md`
- `plans/2026-06-25-encrypted-folder-sync.md`
- `plans/2026-06-26-cloze-input-redesign.md`
- `specs/2026-06-27-quote-tags-system-design.md`
- `plans/2026-06-27-quote-tags-system.md`
- `specs/2026-07-02-watercolor-ui-redesign-design.md`

Tasks 0 through 15, Traditional Chinese conversion, TTS, the real FSRS system,
the focused single-card review experience, cloze-deletion quote review, the
versioned full backup (settings + AI key), encrypted folder sync, the
first-class quote tags system, and the watercolor UI redesign have landed.

## Commands

Use these commands from the repo root:

```bash
npm install
npm run dev
npm run build
npm run compile
npm test
npm run zip
```

Focused tests:

```bash
npx vitest run tests/normalize.test.ts
npx vitest run tests/capture.test.ts
npx vitest run tests/capture-handler.test.ts
npx vitest run tests/pinyin.test.ts
npx vitest run tests/traditional.test.ts
npx vitest run tests/types-srs.test.ts
npx vitest run tests/settings.test.ts
npx vitest run tests/srs.test.ts
npx vitest run tests/review.test.ts
npx vitest run tests/review-queue.test.tsx
npx vitest run tests/backup.test.ts
npx vitest run tests/markdown.test.ts
npx vitest run tests/export.test.ts
npx vitest run tests/cloze.test.ts
npx vitest run tests/cloze-editor.test.tsx
npx vitest run tests/quote-list.test.tsx
npx vitest run tests/tags.test.ts
npx vitest run tests/quote-filter.test.ts
npx vitest run tests/tag-cloud.test.tsx
npx vitest run tests/backup-ai.test.ts
npx vitest run tests/storage-migration.test.ts
npx vitest run tests/sync
```

Regenerate the CC-CEDICT compact asset under `public/dictionaries/`. Requires
a manually-downloaded `cc-cedict.txt`; see `docs/dictionaries/CC-CEDICT.md`.

```bash
npm run build:dictionary
```

`npm run compile` is `tsc --noEmit`.

## Architecture

The central data path is:

1. `entrypoints/background/index.ts` registers context menus and commands.
2. `entrypoints/background/capture-handler.ts` queries the active tab and runs
   `readPageContext` through `browser.scripting.executeScript`.
3. `lib/page-context.ts` reads selected text and page metadata in the page.
4. `lib/capture.ts` decides word vs quote behavior.
5. `lib/storage.ts` persists the inbox with WXT storage.
6. `entrypoints/dashboard/App.tsx` reads and mutates the inbox through
   `entrypoints/dashboard/hooks/useInbox.ts`.
7. `lib/markdown.ts` and `lib/export.ts` render daily notes and zip exports.
8. `lib/dictionary.ts`, `lib/dictionary-loader.ts`, and `lib/word-insight.ts`
   add an offline Word Insight Panel: definitions, tone chips, highlighted
   source examples, and external dictionary links — all computed at view time,
   not persisted on `WordEntry`.
9. `lib/ai/*` adds an opt-in BYO-key AI layer. AI insight is generated only
   after an explicit user click, then persisted on `WordEntry.aiInsight`.
10. `lib/traditional.ts` and `entrypoints/dashboard/components/TraditionalButton.tsx`
    add one-click Simplified → Taiwan Traditional conversion for word and quote
    cards. Converted text is generated only after an explicit user click, then
    persisted on `EntryBase.traditionalText`.
11. `lib/srs.ts` is the only importer of `ts-fsrs`. It lazily migrates legacy
    review state, schedules ratings, builds the due queue, computes review
    stats, and preserves minute-scale learning steps.
12. `entrypoints/dashboard/components/ReviewQueue.tsx` renders only the first
    filtered due card. Word answers remain hidden until Reveal. Quote cards use
    cloze deletion: the active blank is hidden on the front; Reveal shows the
    full quote with the answer highlighted, the note, and a TTS button. The
    Traditional (繁) toggle is suppressed for quote cloze cards because cloze
    offsets index Simplified text. Rating/postpone updates storage and the
    recalculated queue supplies the next card.
13. `lib/cloze.ts` owns all cloze logic: type guards, overlap detection,
    brace-markup parsing (`parseClozeMarkup` / `seedMarkup`), per-cloze hint
    types (none / pinyin / length), and Anki-style `{{cN::...}}` Markdown
    rendering. `buildSrsQueue` in `lib/srs.ts` expands each `QuoteEntry` into
    one queue item per cloze; quotes with no clozes are skipped entirely
    (parked). FSRS state is stored inline on each `Cloze.review`; there is no
    separate keyed card store. The legacy `QuoteEntry.review` top-level field is
    ignored for scheduling — a one-time reset — and does not need to be cleared
    from storage. Quotes save parked on capture; blanks are added by the user
    either manually (wrap spans in `{ }` and Apply) or via AI suggestions
    (建议填空, requires a configured AI provider).
14. `lib/tags.ts` owns all tag behavior: normalization (lowercase, trim,
    collapse internal whitespace, dedupe), add/remove, frequency counts, and the
    one-time `category` → `tags` migration. `QuoteEntry.tags` is a plain
    `string[]`; the `category` field has been removed. The tag-chip editor on
    `QuoteCard`, the OR-semantics filter in `App.tsx`, and the
    `entrypoints/dashboard/components/TagCloud.tsx` Cloud view all route tag
    writes through `lib/tags.ts`. Tags display during review and in Markdown
    export.
15. `lib/sync/*` adds optional encrypted provider-neutral folder sync.
    `chrome.storage.local` stays authoritative; the user-selected folder is an
    encrypted replica transport reached through the File System Access API (no
    provider API). State is a CRDT: hybrid-logical-clock-stamped LWW registers
    plus add-wins OR-Sets (occurrences, review events, and quote tags). The
    `coordinator` is the sole writer — local mutations flow through it, it
    debounces and merges, and it writes only this profile's replica file.
    `connect` handles create/join vault and folder authorization; `crypto` and
    `vault` encrypt the whole payload (including the AI key) under a passphrase
    whose derived key is remembered locally. Sync triggers: on change, on
    UI startup, on a background `alarms` wakeup
    (`entrypoints/background/sync-mutation-handler.ts`), and on demand.
    `entrypoints/dashboard/SyncStatusBadge.tsx` shows the state;
    `entrypoints/settings/FolderSync.tsx` is the settings UI. Kaikki data and the
    remembered key never sync.

Core modules:

- `lib/types.ts`: persisted data shapes only.
- `lib/normalize.ts`: pure text normalization for word dedupe.
- `lib/id.ts`: dependency-free id helper.
- `lib/storage.ts`: `local:inbox` storage item and serialized mutations.
- `lib/capture.ts`: `saveWord` and `saveQuote`. `saveQuote` saves quotes with
  no cloze blanks (parked); blanks are added later by the user.
- `lib/cloze.ts`: cloze type guards, overlap detection, brace-markup parsing
  (`parseClozeMarkup` / `seedMarkup`), hint types (none / pinyin / length), and
  Anki-style `{{cN::...}}` Markdown rendering. This is the only file that may
  define or validate cloze shapes. Inbox backup format version is 2; v1 backups
  still import (their quotes load parked because they carry no cloze arrays);
  malformed cloze arrays are sanitized to `[]` on import (the quote is
  preserved).
- `lib/page-context.ts`: self-contained injected function.
- `lib/pinyin.ts`: `pinyin-pro` wrapper for lazy dashboard pinyin generation.
- `lib/traditional.ts`: `opencc-js` wrapper for lazy dashboard Simplified →
  Taiwan Traditional conversion using `cn -> twp`.
- `lib/srs.ts`: the only `ts-fsrs` importer; scheduler construction,
  ReviewState/Card conversion, lazy migration, ratings, postpone, due queue,
  wake time, and local review stats. `buildSrsQueue` expands each `QuoteEntry`
  into one item per cloze (quotes with no clozes are skipped). Cloze FSRS
  state lives on `Cloze.review`; the legacy top-level `QuoteEntry.review`
  field is ignored and treated as a one-time scheduling reset.
- `lib/review.ts`: compatibility wrapper that delegates queue building to
  `lib/srs.ts`.
- `lib/settings.ts`: `local:settings` storage plus normalized read, watch,
  mutation, and replacement helpers so old installs gain nested defaults.
- `lib/tags.ts`: the only owner of tag behavior — normalization (lowercase,
  trim, collapse whitespace, dedupe), add/remove, frequency counts, and the
  `category` → `tags` migration. `QuoteEntry.tags` is a plain `string[]`; the
  `category` field is gone. Do not normalize or mutate tags elsewhere.
- `lib/backup.ts`: versioned JSON backup. `BACKUP_FORMAT_VERSION` (2) is the
  inbox-only backup; `FULL_BACKUP_FORMAT_VERSION` (3) is the full backup that
  also carries `AppSettings` and `AiSettings` (including the API key). Restore
  validates each version and treats unknown/lower versions as inbox-only.
- `lib/sync/*`: encrypted provider-neutral folder sync. `types.ts` defines the
  CRDT `SyncState` (HLC-stamped LWW registers + add-wins OR-Sets for
  occurrences, review events, and quote tags). `project.ts` projects inbox ↔
  state; tag add-stamps are carried forward so unrelated edits never move them.
  `merge.ts` is the deterministic merge; `coordinator.ts` is the sole writer
  (debounced); `connect.ts` does create/join + folder authorization; `crypto.ts`
  / `vault.ts` encrypt the whole payload under a passphrase; `files.ts` is
  File System Access folder I/O; `local.ts` holds `local:syncConfig` and
  `mutations.ts` holds `local:syncMetadata` + queued mutations. Each profile
  writes only its own replica; Kaikki data and the remembered key never sync.
- `lib/pinyin-helpers.ts`: CC-CEDICT numbered pinyin → tone marks/numbers, and
  pinyin-pro fallback for tone chips when no dictionary match exists.
- `lib/dictionary.ts`: CC-CEDICT parsing, compact asset build/materialize,
  lookup index, exact lookup, and component fallback segmentation.
- `lib/dictionary-cache.ts`: IndexedDB-backed cache for the parsed index,
  keyed by the asset hash.
- `lib/dictionary-loader.ts`: dashboard-only fetch + cache hydrate/build for
  the compact asset under `public/dictionaries/`.
- `lib/word-insight.ts`: pure composition of dictionary, tone chips, source
  examples, and external links into a `WordInsight`.
- `lib/external-dictionaries.ts`: click-only encoded MDBG and 百度汉语 URLs.
- `lib/ai/settings.ts`: WXT storage for `local:aiSettings` and provider
  preset table (DeepSeek, OpenAI, custom endpoint).
- `lib/ai/prompt.ts`: pure function that builds the OpenAI-style messages
  array for the AI request.
- `lib/ai/parse.ts`: pure validation of the model JSON response into
  `AiInsight`.
- `lib/ai/client.ts`: single `fetch` to `${baseUrl}/chat/completions` with
  typed error handling.
- `lib/ai/permissions.ts`: lazy `chrome.permissions.request` for the
  configured provider origin.
- `lib/markdown.ts`: pure daily Markdown rendering.
- `lib/export.ts`: daily export map and zip byte generation.
- `entrypoints/popup/Popup.tsx`: toolbar capture buttons.
- `entrypoints/dashboard/components/WordInsightPanel.tsx`: insight UI inside
  `WordCard`.
- `entrypoints/settings/AiSettingsPanel.tsx`: provider picker,
  masked key, model, test connection.
- `entrypoints/dashboard/components/AskAiButton.tsx`: trigger with idle /
  disabled / loading / error / retry states.
- `entrypoints/dashboard/components/AiInsightSection.tsx`: renders persisted AI
  insight below local sections.
- `entrypoints/dashboard/components/TraditionalButton.tsx`: generate / show / hide
  control for cached Taiwan Traditional text on word and quote cards.
- `entrypoints/dashboard/components/ReviewInsightReveal.tsx`: reveal interaction
  in `ReviewQueue`.
- `entrypoints/dashboard/hooks/useWordInsight.ts`: loads the dictionary once per
  dashboard session and computes insight per word.
- `entrypoints/dashboard/hooks/useAiInsight.ts`: orchestrates settings → client
  → persist on `WordEntry`.
- `entrypoints/settings/kaikki-import.worker.ts`: streams a user-selected
  Kaikki JSONL file off the settings UI thread, reports progress, builds the
  fallback index, and stores it in IndexedDB.
- `lib/kaikki.ts`: Kaikki JSONL parser, streaming parser, URL validation, and
  entry hashing. The parser intentionally filters out records without Han
  characters or without usable `glosses` / `raw_glosses`; progress UI should
  describe these as filtered records rather than failed imports. Definition
  bearing records may index Han-character `forms` as runtime lookup variants;
  no-gloss soft redirects stay filtered unless the target definition appears on
  another record with that form.
- `entrypoints/dashboard/`: dashboard shell, toolbar, cards, lists, and storage
  hook.

## Conventions

- Keep capture behavior funneled through `lib/capture.ts`; do not duplicate
  dedupe or storage writes in UI entrypoints.
- Keep injected functions self-contained. `readPageContext` must not depend on
  imported closure state because it is serialized into the active tab.
- Prefer pure modules for behavior that can be unit-tested without Chrome APIs.
- Keep Traditional conversion as a display annotation. Do not use
  `traditionalText` for capture, normalize, dedupe, review scheduling, Markdown
  export, or zip export behavior.
- Keep all scheduler calls and `ts-fsrs` imports inside `lib/srs.ts`.
- Treat the SRS queue as the review-session source of truth; do not persist a
  separate current-card index.
- In Review, hide word insight until Reveal. For quote cloze cards, hide the
  active blank on the front (hint-aware) and reveal the full quote with the
  answer highlighted on Reveal. The Traditional (繁) toggle is suppressed for
  quote cloze cards because cloze offsets index Simplified text.
- Keep SRS state local on each entry. Do not use it for capture dedupe.
- Funnel all tag reads/writes through `lib/tags.ts`; normalize before persisting
  and never reintroduce the removed `category` field.
- Route local mutations that must sync through the `lib/sync` coordinator (the
  sole writer). Keep `chrome.storage.local` authoritative; the folder is a
  transport. Do not sync Kaikki data or the remembered key.
- Use `@/*` imports where existing WXT code does, and relative imports where the
  file already uses that style.
- Use `apply_patch` for manual edits.
- Do not revert user changes. Check `git status --short` before editing.

## WXT And Fake-Browser Notes

- For WXT `0.20.26`, import storage from `wxt/utils/storage`, not
  `wxt/storage`.
- For WXT browser types, use:

```ts
import type { Browser } from 'wxt/browser';
type ActiveTab = Browser.tabs.Tab;
```

- `@webext-core/fake-browser` does not expose the plan's older
  `setReturnValue` / `setReject` helpers. Use Vitest spies instead:

```ts
vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([...]);
vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([...]);
```

- `fakeBrowser.reset()` clears storage and event state between tests.

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

Expected manifest features include `contextMenus`, `storage`, `activeTab`,
`scripting`, `downloads`, `unlimitedStorage`, `alarms` (background folder sync),
`clipboardRead`, `tts`, command shortcuts, a toolbar popup, and an MV3
background service worker.
