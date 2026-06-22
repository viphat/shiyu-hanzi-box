# Agent Instructions

## Project Summary

This repo is `shiyu-hanzi-box`, a local-first Chrome MV3 extension named
拾语汉字box. Its job is to capture selected Chinese text as words or quotes,
store the working inbox in `chrome.storage.local`, and export daily Markdown
notes.

The implementation plan is in:

- `docs/superpowers/plans/2026-06-20-shiyu-hanzi-box.md`
- `docs/superpowers/specs/2026-06-20-shiyu-hanzi-box-design.md`
- `docs/superpowers/plans/2026-06-21-word-insight-panel-ai.md`

Tasks 0 through 15 have landed.

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
npx vitest run tests/markdown.test.ts
npx vitest run tests/export.test.ts
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
6. `entrypoints/newtab/App.tsx` reads and mutates the inbox through
   `entrypoints/newtab/hooks/useInbox.ts`.
7. `lib/markdown.ts` and `lib/export.ts` render daily notes and zip exports.
8. `lib/dictionary.ts`, `lib/dictionary-loader.ts`, and `lib/word-insight.ts`
   add an offline Word Insight Panel: definitions, tone chips, highlighted
   source examples, and external dictionary links — all computed at view time,
   not persisted on `WordEntry`.
9. `lib/ai/*` adds an opt-in BYO-key AI layer. AI insight is generated only
   after an explicit user click, then persisted on `WordEntry.aiInsight`.

Core modules:

- `lib/types.ts`: persisted data shapes only.
- `lib/normalize.ts`: pure text normalization for word dedupe.
- `lib/id.ts`: dependency-free id helper.
- `lib/storage.ts`: `local:inbox` storage item and serialized mutations.
- `lib/capture.ts`: `saveWord` and `saveQuote`.
- `lib/page-context.ts`: self-contained injected function.
- `lib/pinyin.ts`: `pinyin-pro` wrapper for lazy dashboard pinyin generation.
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
- `entrypoints/newtab/components/WordInsightPanel.tsx`: insight UI inside
  `WordCard`.
- `entrypoints/newtab/components/AiSettingsPanel.tsx`: provider picker,
  masked key, model, test connection.
- `entrypoints/newtab/components/AskAiButton.tsx`: trigger with idle /
  disabled / loading / error / retry states.
- `entrypoints/newtab/components/AiInsightSection.tsx`: renders persisted AI
  insight below local sections.
- `entrypoints/newtab/components/ReviewInsightReveal.tsx`: reveal interaction
  in `ReviewQueue`.
- `entrypoints/newtab/hooks/useWordInsight.ts`: loads the dictionary once per
  dashboard session and computes insight per word.
- `entrypoints/newtab/hooks/useAiInsight.ts`: orchestrates settings → client
  → persist on `WordEntry`.
- `entrypoints/newtab/`: dashboard shell, toolbar, cards, lists, and storage
  hook.

## Conventions

- Keep capture behavior funneled through `lib/capture.ts`; do not duplicate
  dedupe or storage writes in UI entrypoints.
- Keep injected functions self-contained. `readPageContext` must not depend on
  imported closure state because it is serialized into the active tab.
- Prefer pure modules for behavior that can be unit-tested without Chrome APIs.
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
`scripting`, `downloads`, `unlimitedStorage`, command shortcuts, a toolbar
popup, a new-tab override, and an MV3 background service worker.
